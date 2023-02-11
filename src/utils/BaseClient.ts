import { z } from "zod";
import { Channel, ServiceChannel, TopicChannel } from "./Channel";
import { diff, DiffResult, mergeDiff, RecursivePartial } from "./Compare";
import { metaMessageSchema, MessageMeta, RequestFullTopicMessage, topicMessageSchema, requestFullTopicMessageSchema, TopicMessage, WithMeta, MessageType, ServiceMessage, serviceMessageSchema, ServiceResponseMessage, serviceResponseMessageSchema } from "../messages/Messages";
import { JSONObject, JSONValue } from "./JSON";
import { v4 as uuidv4 } from 'uuid';
import { serverMetaChannel } from "../metaChannels";
import { cloneDeep } from "lodash";

export const channelPrefix = "ch-";
export const servicePrefix = "sv-";
export const topicPrefix = "tp-";
export const userPrefix = "us-";
export const metaPrefix = "mt-";

export type OnReceiveTopicMessageArgs<T extends JSONValue, V = void> = {
    socket?: V;
    message: WithMeta<TopicMessage>, valid: boolean, diffResult: DiffResult<T, T>, fullTopic: RecursivePartial<T>
}

export type OnReceiveRequestFullTopicMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<RequestFullTopicMessage>, alreadyHasFullTopic: boolean
}

export type OnReceiveServiceMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<ServiceMessage>, valid: boolean
}

export type OnReceiveServiceResponseMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<ServiceMessage>, valid: boolean
}

export type DestType = string[] | "*";

export abstract class BaseClient<V = void> {
    protected channelSchemaMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected channelResponseSchemaMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected topicHandlerMap: Map<string, ((value: JSONValue) => void)[]> = new Map();
    protected topicMap: Map<string, JSONValue> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected topicsValid: Map<string, boolean> = new Map();
    protected serviceHandlerMap: Map<string, (data: JSONValue) => JSONValue> = new Map();
    protected id: string;
    protected serviceResolvers: Map<string, (data: JSONValue) => void> = new Map();
    protected serviceRejectors: Map<string, (reason: any) => void> = new Map();

    // Abstract methods
    protected abstract onRawEvent(event: string, listener: (data: any, sender: V) => void): void; // On an event, with the option to specify the sender (for differentiating where the message came from), but only used optionally per implementation
    protected abstract emitRawEvent(event: string, data: any, destination: DestType): void;

    // Default constructor
	constructor() {
        this.id = uuidv4();
	}

    protected initialize(): void {
        this.sub(serverMetaChannel);
        this.pub(serverMetaChannel, {
            clients: {
                [this.id]: {
                }
            }
        }, true, false);
    }

    // Helper / convenience methods
    protected getChannelName<T extends JSONValue>(channel: Channel<T>): string {
        let topicMode: string;
        if (channel.mode === "topic") {
            topicMode = topicPrefix;
        } else if (channel.mode === "service") {
            topicMode = servicePrefix;
        } else {
            throw new Error("Invalid channel mode");
        }
        let topicType: string;
        if (channel.meta === true) {
            topicType = metaPrefix;
        } else {
            topicType = userPrefix;
        }
        return [channelPrefix, topicMode, topicType].join("")+channel.name;
    }

    hasValidTopic<T extends JSONValue>(channel: Channel<T>): boolean {
        return this.topicsValid.get(this.getChannelName(channel)) ?? false;
    }

    // Messages
    protected wrapMessage(rawMessage: JSONObject, messageType: MessageType, source?: string): MessageMeta {
        return {...rawMessage, timestamp: Date.now(), messageType, source: source ?? this.id};
    }

    protected sendTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, diff: DiffResult<T, T>, source?: string): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(diff as JSONObject, "topic", source), "*");
    }

    sendDiffTopic<T extends JSONValue>(channel: TopicChannel<T>, diffResult: DiffResult<T, T>, source?: string): void {
        this.sendTopicMessage(channel, diffResult as JSONObject, source);
    }

    sendFullTopic<T extends JSONValue>(channel: TopicChannel<T>, source?: string): void {
        console.log(`Client ${this.id} sending full topic for channel ${channel.name}`)
        // Try to get full topic from channel
        const fullTopic = this.getTopic(channel);
        if (fullTopic === undefined) {
            console.warn(`Cannot send full topic for channel ${channel.name} - no full topic available`);
            return;
        } else {
            this.sendDiffTopic(channel, {
                // @ts-ignore - this is a valid topic, but the type system doesn't know that
                modified: fullTopic
            }, source);
        }
    }

    sendRequestFullTopic<T extends JSONValue>(channel: TopicChannel<T>, source?: string): void {
        console.log(`Client ${this.id} sending request full topic for channel ${channel.name}`)
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({}, "requestFullTopic", source), "*");
    }

    sendNoServiceHandlerMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, id: string, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            serviceId: id,
            dest,
            noServiceHandler: true
        }, "serviceResponse"), [dest]);
    }
    sendServiceResponseMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, id: string, result: JSONValue, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            responseData: result,
            serviceId: id,
            dest
        }, "serviceResponse"), [dest]);
    }

    sub<T extends JSONValue>(channel: TopicChannel<T>, handler?: (topic: T) => void, initialUpdate: boolean=true): void {
        if (channel.mode !== "topic") throw new Error("Channel is not a topic channel");
        const eventName = this.getChannelName(channel);
        if (!this.channelSchemaMap.has(eventName)) { // Initialize channel if not already initialized
            this.topicMap.set(eventName, {});
            if (this.topicHandlerMap.has(eventName) === false) {
                this.topicHandlerMap.set(eventName, []);
            }
            // Add raw event listener
            this.onRawEvent(eventName, (msg: MessageMeta, sender: V) => {
                // Validate the message - in the sense that it is a valid message type, but doesn't guarantee that the topic is valid
                const validMessage = metaMessageSchema.safeParse(msg).success;
                if (!validMessage) {
                    console.warn("Invalid message received: ", msg);
                    return;
                }
                metaMessageSchema.parse(msg);
                if (msg.messageType === "requestFullTopic" && requestFullTopicMessageSchema.safeParse(msg).success) {
                    this.onReceiveRequestFullTopicMessage<T>(channel, msg as WithMeta<RequestFullTopicMessage>, sender);
                    return;
                } 
                if (msg.messageType === "topic" && topicMessageSchema.safeParse(msg).success) {
                    this.onReceiveTopicMessage<T>(channel, msg as WithMeta<TopicMessage>, sender);
                    return;
                }
                console.warn(`Invalid message received for topic channel ${channel.name}:`, msg);
            });
            this.sendRequestFullTopic(channel);
        }
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            this.topicHandlerMap.get(eventName)?.push(handler as (topic: JSONValue) => void);
        }
        if (initialUpdate && this.hasValidTopic(channel)) {  
            handler?.(this.getTopic(channel));
        }
    }

    srv<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, handler?: (topic: T) => U): void {
        if (channel.mode !== "service") throw new Error("Channel is not a service channel");
        // Initialize channel
        const eventName = this.getChannelName(channel);
        const channelType = channel.mode;
        this.listenServiceChannel(channel);
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            this.serviceHandlerMap.set(eventName, handler as (service: JSONValue) => U);
        }
    }

    private listenServiceChannel<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>) {
        const eventName = this.getChannelName(channel);
        if (!this.channelSchemaMap.has(eventName)) { // Initialize channel if not already initialized
            this.channelSchemaMap.set(eventName, channel.schema);
            this.channelResponseSchemaMap.set(eventName, channel.responseSchema);
            // Add raw event listener
            this.onRawEvent(eventName, (msg: MessageMeta, sender: V) => {
                const validMessage = metaMessageSchema.safeParse(msg).success;
                if (!validMessage) {
                    console.warn("Invalid message received: ", msg);
                    return;
                }
                metaMessageSchema.parse(msg);
                if (msg.messageType === "serviceResponse" && serviceResponseMessageSchema.safeParse(msg).success) {
                    this.onReceiveServiceResponseMessage<T, U>(channel, msg as WithMeta<ServiceResponseMessage>, sender);
                    return;
                }
                if (msg.messageType === "service" && serviceMessageSchema.safeParse(msg).success) {
                    this.onReceiveServiceMessage<T, U>(channel, msg as WithMeta<ServiceMessage>, sender);
                    return;
                }
                console.warn(`Invalid message received for service channel ${channel.name}:`, msg);
            });
        }
    }

    /**
     * Handle response - resolve the promise for the service
     * Common: If the message is for them, they should resolve the promise
     * Server: If the message is for another client, they should forward the message to that client
     */
    protected onReceiveServiceResponseMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceResponseMessage>, sender: V) {
        const resolver = this.serviceResolvers.get(msg.serviceId);
        const rejector = this.serviceRejectors.get(msg.serviceId);
        if (resolver === undefined || rejector === undefined) {
            console.warn("No resolver or rejector for service id: ", msg.serviceId, ", perhaps the service timed out?");
            return;
        }
        if (msg.noHandler) {
            rejector(new Error("No service handler"));
        } else {
            resolver(msg.responseData as U);
        }
    }

    protected onReceiveServiceMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceMessage>, sender?: V) {
        // Get the handler
        const eventName = this.getChannelName(channel);
        const handler = this.serviceHandlerMap.get(eventName);
        if (handler === undefined) {
            console.warn(`No handler for channel ${channel.name}`);
            // Dest is now the source, source is now the dest (object's id, which is that be default anyway)
            this.sendNoServiceHandlerMessage(channel, msg.serviceId, msg.source);
        } else {
            // Run the handler
            const result = handler(msg.serviceData as JSONValue);
            // Send the result
            this.sendServiceResponseMessage(channel, msg.serviceId, result, msg.source);
        }
    }

    /**
     * Topic message handler
     * Common behaviour: If you receive a topic message, you should update your topic
     * Server specific behaviour: Directly broadcast the message to all other clients
     */
    protected onReceiveTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<TopicMessage>, sender?: V) {
        // See if we have the topic initialized. It should, because we need to initalize it before we can receive updates.
        const eventName = this.getChannelName(channel);
        const currentTopic = this.topicMap.get(eventName);
        if (this.topicMap.has(eventName) === false) {
            throw new Error(`Topic for channel ${channel.name} not initialized`);
        };
        // Cast the message to the correct type
        const diffResult = msg as unknown as DiffResult<T, T>;
        // Update the topic
        // const oldTopic = cloneDeep(currentTopic);
        const newTopic = mergeDiff(currentTopic, diffResult);
        // See if the new topic is valid according to the topic schema
        const previouslyValid = this.topicsValid.get(eventName) ?? false;
        const parse = channel.schema.safeParse(newTopic);
        const valid = parse.success;
        // if (!valid) {
        //     console.log(`${this.id}: ❌ Topic ${channel.name} is invalid:`, parse.error);
        // }
        // Throw an error indicating what the topic is invalid
        // Update the topic validity and value, and call the handler if it is valid and if there are any changes
        if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
            // console.log("Previously valid: ", previouslyValid)
            if (previouslyValid !== true) {
                if (valid) {
                    console.log(`${this.id}: 🎊 Topic ${channel.name} is now valid, applying changes`);
                    this.topicsValid.set(eventName, true);
                    this.topicMap.set(eventName, newTopic);
                    this.topicHandlerMap.get(eventName)?.forEach(handler => handler(newTopic));
                } else {
                    console.log(`${this.id}: 🤔 Topic ${channel.name} is still invalid, but applying changes`);
                    // Still update the topic value, but don't call the handler
                    this.topicMap.set(eventName, newTopic);
                }
            } else {
                if (valid) {
                    console.log(`${this.id}: 😀 Topic ${channel.name} is still valid, applying changes`);
                    // If previously valid and now is still valid, apply the changes
                    this.topicMap.set(eventName, newTopic);
                    this.topicHandlerMap.get(eventName)?.forEach(handler => handler(newTopic));
                } else {
                    console.log(`${this.id}: 🚨 Topic ${channel.name} is invalid after changes, not applying changes`);
                    // If previously valid and now is invalid, don't apply the changes
                }
            }
            console.log(`${this.id}:`, newTopic);
            // console.log(`🧓 Old topic:`, currentTopic, `👶 New topic:`, newTopic, `📝 Diff:`, diffResult);
        }
    }

    /**
     * Handle request for full topic - send full topic if channel is topic, and we have a valid topic
     * Common behaviour: If you receive a request for full topic, you should send the full topic if you have it
     * Server specific behaviour: Broadcast request for all clients
     */
    protected onReceiveRequestFullTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<RequestFullTopicMessage>, sender: V) {
        if (this.hasValidTopic(channel)) {
            this.sendFullTopic(channel);
        } else {
            console.warn(`Invalid topic for channel ${channel.name}, sending anyway`);
            this.sendFullTopic(channel);
        }
    }

    // Not recommended for use with allowDeletions since multiple clients can accidentally overwrite each other's topic
    // Only use if you are sure that the topic is not being updated by other clients
    _set<T extends JSONValue>(channel: Channel<T>, data: RecursivePartial<T>, updateSelf: boolean = true, allowDeletions: boolean = false, source?: string): void {
        const eventName = this.getChannelName(channel);
        const currentTopic = this.topicMap.get(eventName);
        if (currentTopic === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentTopic as T, data as JSONValue);
        // Disallow deletions of topic properties
        if (!allowDeletions) {
            diffResult.deleted = undefined;
        }
        // Only emit if there are changes
        if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
            // Apply the changes to the topic
            const newTopic = mergeDiff(currentTopic, diffResult);
            this.topicMap.set(eventName, newTopic);
            this.sendDiffTopic(channel as TopicChannel<T>, diffResult as DiffResult<T, T>, source); 
            if (updateSelf) {
                // this.topicHandlerMap.get(eventName)?.forEach(handler => handler(newTopic));
                // Send yourself the message, so that it runs through the same logic as if it was received from another client
                this.onReceiveTopicMessage(channel as TopicChannel<T>, this.wrapMessage(diffResult as JSONObject, "topic", source ?? this.id) as WithMeta<TopicMessage>)
            }
        }
    }

    pub<T extends JSONValue>(channel: TopicChannel<T>, data: RecursivePartial<T>, updateSelf?: boolean, publishDeletes: boolean=true, source?: string,): void {
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        this._set(channel, data, updateSelf, publishDeletes, source);
    }

    // req<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, serviceData: T, dest: DestType, timeout: number=10000): Promise<U> { // TODO: Support multiple destinations
    req<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, serviceData: T, dest: string, timeout: number=10000): Promise<U> {
        this.listenServiceChannel(channel);
        if (channel.mode !== "service") {
            throw new Error("Channel is not a service channel");
        }
        // See if service is valid
        const valid = channel.schema.safeParse(serviceData).success;
        if (!valid) {
            throw new Error("Service data is not valid");
        }
        // Send the service
        const id = this.sendServiceMessage(channel, serviceData, [dest]);
        // Create a promise that resolves when the response is received
        return new Promise((resolve, reject) => {
            // Set a timeout
            const timeoutId = setTimeout(() => {
                reject(new Error("Service timed out"));
            }, timeout);
            // Add the promise to the map
            this.serviceResolvers.set(id, (result: JSONValue) => {
                clearTimeout(timeoutId);
                this.serviceResolvers.delete(id);
                this.serviceRejectors.delete(id);
                resolve(result as U);
            })
            this.serviceRejectors.set(id, (reason: any) => {
                clearTimeout(timeoutId);
                this.serviceResolvers.delete(id);
                this.serviceRejectors.delete(id);
                reject(reason);
            })
        });
    }

    protected sendServiceMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, serviceData: T, dest: DestType): string {
        if (channel.mode !== "service") {
            throw new Error("Channel is not a service channel");
        }
        const id = uuidv4();
        const msg: ServiceMessage = {
            serviceData,
            serviceId: id,
            dest,
        }
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(msg as JSONObject, "service"), dest);
        return id;
    }

    protected getTopic<T extends JSONValue>(channel: Channel<T>): T {
        const channelName = this.getChannelName(channel);
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        const currentTopic = this.topicMap.get(channelName);
        if (currentTopic === undefined) {
            throw new Error(`Topic ${channel.name} not found`);
        }
        // if (!this.topicsValid.get(channelName)) {
        //     throw new Error("Topic is not valid");
        // }
        return currentTopic as T;
    }
}