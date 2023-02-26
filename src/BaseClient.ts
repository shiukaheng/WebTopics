import { z } from "zod";
import { Channel, RequestType, ServiceChannel, ServiceResponseType, TopicChannel } from "./utils/Channel";
import { TopicServer } from "./Server";
import { diff, DiffResult, mergeDiff, RecursivePartial } from "./utils/Compare";
import { metaMessageSchema, MessageMeta, RequestFullTopicMessage, topicMessageSchema, requestFullTopicMessageSchema, TopicMessage, WithMeta, MessageType, ServiceMessage, serviceMessageSchema, ServiceResponseMessage, serviceResponseMessageSchema } from "./messages/Messages";
import { JSONObject, JSONValue } from "./utils/JSON";
import { v4 as uuidv4 } from 'uuid';
import { serverMetaChannel, ServerMeta } from "./metaChannels";
import zodToJsonSchema from "zod-to-json-schema";

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

/**
 * The type of a function that can be used to unsubscribe from a topic
 */
export type Unsubscriber = () => void;

/**
 * Extra metadata sent with each update to a topic
 */
export interface SubscriberMeta<T extends JSONValue> {
    /**
     * The diff compared to the previous value
     */
    diff: DiffResult<T, T>;
    /**
     * The source of the update
     */
    source: string;
} 

export type Subscriber<T extends JSONValue> = (value: T, unsubscribe: Unsubscriber, meta: SubscriberMeta<T>) => void;

/**
 * Base class for {@link TopicClient} and {@link TopicServer} classes, responsible for keeping track of topics and services, and sending and receiving messages
 */
export abstract class BaseClient<V = void> {
    /**
     * Map of channel names to their schemas (both topic and service)
     */
    protected channelSchemaMap: Map<string, z.ZodSchema<RequestType>> = new Map();
    /**
     * Map of service channel names to their response schemas
     */
    protected channelResponseSchemaMap: Map<string, z.ZodSchema<ServiceResponseType>> = new Map();
    /**
     * Map of topic channel names to a list of change handlers 
     */
    protected topicHandlerMap: Map<string, (Subscriber<JSONValue>)[]> = new Map();
    /**
     * Map of topic channel names to their current values
     */
    protected topicMap: Map<string, JSONValue> = new Map(); // Not guaranteed to be complete, need validation on each update
    /**
     * Map of topic channel names to whether they are valid according to the schema
     */
    protected topicsValid: Map<string, boolean> = new Map();
    /**
     * Map of service channel names to their handlers
     */
    protected serviceHandlerMap: Map<string, (data: RequestType) => ServiceResponseType | Promise<ServiceResponseType>> = new Map();
    /**
     * Internal ID of the client, not to be directly used; use the getter instead
     */
    protected _id: string;
    /**
     * Map of open service request IDs to their resolvers
     */
    protected serviceResolvers: Map<string, (data: ServiceResponseType) => void> = new Map();
    /**
     * Map of open service request IDs to their rejectors
     */
    protected serviceRejectors: Map<string, (reason: any) => void> = new Map();
    /**
     * Map of topic to their last valid diffs and sources
     */
    protected lastValidDiffMap: Map<string, {diff: DiffResult<JSONValue, JSONValue>, source: string}> = new Map();

    // Abstract methods

    /**
     * Abstract method for subscribing to a raw socket event
     * @param event The event name
     * @param listener The listener function
     */
    protected abstract onRawEvent(event: string, listener: (data: any, sender?: V) => void): void; // On an event, with the option to specify the sender (for differentiating where the message came from), but only used optionally per implementation
    
    /**
     * Abstract method for emitting a raw socket event
     * @param event The event name
     * @param data The data to send
     * @param destination The destination of the event
     */
    protected abstract emitRawEvent(event: string, data: any, destination: DestType): void;

    // Default constructor
    /**
     * Create a new {@link BaseClient} instance
     */
    constructor() {
        this._id = uuidv4();
    }

    /**
     * Initalize the client by subscribing to the server meta channel, and publishing the client's meta data to the server
     */
    protected initialize(): void {
        this.pub(serverMetaChannel, {
            clients: {
                [this._id]: {
                    services: {

                    }
                }
            }
        }, true, false);
    }

    // Helper / convenience methods

    /**
     * Gets the actual channel name from the channel object, including prefixes
     * @param channel The channel object
     * @returns The channel name
     */
    protected getChannelName<T extends RequestType=void>(channel: Channel<T>): string {
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
        return [channelPrefix, topicMode, topicType].join("") + channel.name;
    }

    /**
     * Checks if the topic channel is valid according to the schema
     * @param channel The channel object
     * @returns Whether the topic is valid
     */
    hasValidTopic<T extends JSONValue>(channel: Channel<T>): boolean {
        return this.topicsValid.get(this.getChannelName(channel)) ?? false;
    }

    // Messages

    /**
     * Wraps a raw message with its message type and metadata
     * @param rawMessage The raw message
     * @param messageType The message type
     * @param source The source of the message
     * @returns The wrapped message
     */
    protected wrapMessage(rawMessage: JSONObject, messageType: MessageType, source?: string): MessageMeta {
        return { ...rawMessage, timestamp: Date.now(), messageType, source: source ?? this._id };
    }

    /**
     * Broadcasts a diff to the specified topic channel
     * @param channel The channel object
     * @param diff The diff to send
     * @param source The source of the message
     */
    protected sendDiffTopic<T extends JSONValue>(channel: TopicChannel<T>, diff: DiffResult<T, T>, source?: string): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(diff as JSONObject, "topic", source), "*");
    }

    /**
     * Broadcasts a full topic according to internal records to the specified topic channel
     * @param channel The channel object
     * @param source The source of the message (optional and defaults to the current client, only used in {@link TopicServer})
     */
    protected sendFullTopic<T extends JSONValue>(channel: TopicChannel<T>, source?: string): void {
        // console.log(`Client ${this.id} sending full topic for channel ${channel.name}`)
        // Try to get full topic from channel
        const fullTopic = this._getUnsafeTopic(channel);
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

    /**
     * Broadcasts a request for a full topic to the specified topic channel
     * @param channel The channel object
     * @param source The source of the message (optional and defaults to the current client, only used in {@link TopicServer})
     */
    protected sendRequestFullTopic<T extends JSONValue>(channel: TopicChannel<T>, source?: string): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({}, "requestFullTopic", source), "*");
    }

    /**
     * Sends a no service handler response message to the specified service channel and destination
     * @param channel The channel object
     * @param id The service ID
     * @param dest The destination of the message
     */
    protected sendNoServiceHandlerMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, id: string, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            serviceId: id,
            dest,
            noServiceHandler: true
        }, "serviceResponse"), [dest]);
    }

    /**
     * Sends a service response message to the specified service channel and destination
     * @param channel The channel object
     * @param id The service ID
     * @param result The response data
     * @param dest The destination of the message
     */
    protected sendServiceResponseMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, id: string, result: ServiceResponseType, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            serviceId: id,
            dest,
            // If reponse data is undefined, don't send it (for services that don't return anything)
            ...(result !== undefined ? { responseData: result } : {})
        }, "serviceResponse"), [dest]);
    }

    /**
     * Sends a service error message to the specified service channel and destination
     * @param channel The channel object
     * @param id The service ID
     * @param errorMesssage The error message
     * @param dest The destination of the message
     */
    protected sendServiceErrorMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, id: string, errorMesssage: string, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            serviceId: id,
            dest,
            errorMessage: errorMesssage
        }, "serviceResponse"), [dest]);
    }

    /**
     * Subscribes to the changes of a topic channel
     * @param channel The channel object
     * @param handler The handler function to call when the topic changes
     * @param initialUpdate Whether to immediately call the handler with the current topic value when subscribing
     * @returns The unsubscriber function
     */
    sub<T extends JSONValue>(channel: TopicChannel<T>, handler: Subscriber<T>, initialUpdate: boolean = true): Unsubscriber {
        if (channel.mode !== "topic") throw new Error("Channel is not a topic channel");
        this.initTopicChannel<T>(channel);
        const eventName = this.getChannelName(channel);
        this.topicHandlerMap.get(eventName)?.push(handler as (topic: JSONValue) => void);
        const unsubscriber = this.createUnsubscriber(eventName, handler);
        if (initialUpdate && this.hasValidTopic(channel)) {
            // Manually call the handler with the current topic value
            const history = this.lastValidDiffMap.get(eventName);
            if (history === undefined) throw new Error("History is undefined");
            // @ts-ignore - this is a valid topic, but the type system doesn't know that
            handler(this.getTopicSync(channel), unsubscriber, history);
        }
        return unsubscriber;
    }

    /**
     * Subscribes to the changes of a topic channel once (convenience function)
     * @param channel The channel object
     * @param handler The handler function to call when the topic changes
     * @param initialUpdate Whether to immediately call the handler with the current topic value when subscribing
     * @returns The unsubscriber function
     */
    subOnce<T extends JSONValue>(channel: TopicChannel<T>, handler: Subscriber<T>, initialUpdate: boolean = true): Unsubscriber {
        return this.sub(channel, (topic, unsubscriber, history) => {
            unsubscriber();
            handler(topic, unsubscriber, history);
        }, initialUpdate);
    }

    /**
     * Initializes a topic channel with handlers and a topic map entry
     * @param channel The channel object
     */
    protected initTopicChannel<T extends JSONValue>(channel: TopicChannel<T>) {
        const eventName = this.getChannelName(channel);
        if (!this.channelSchemaMap.has(eventName)) { // Initialize channel if not already initialized
            this.channelSchemaMap.set(eventName, channel.schema);
            this.topicMap.set(eventName, {});
            if (this.topicHandlerMap.has(eventName) === false) {
                this.topicHandlerMap.set(eventName, []);
            }
            // Add raw event listener
            this.onRawEvent(eventName, (msg: MessageMeta, sender?: V) => {
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
    }

    /**
     * Serves a service channel by registering a handler function
     * @param channel The channel object
     * @param handler The handler function to call when a service is requested
     */
    srv<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, handler: (topic: T) => U | Promise<U>): void {
        if (channel.mode !== "service") throw new Error("Channel is not a service channel");
        // Initialize channel
        const eventName = this.getChannelName(channel);
        this.initServiceChannel(channel);
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            // @ts-ignore - The type should be guaranteed to be correct from the generic type
            this.serviceHandlerMap.set(eventName, handler);
        }
    }

    /**
     * Initializes a service channel with handlers
     * @param channel 
     */
    protected initServiceChannel<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>) {
        const eventName = this.getChannelName(channel);
        if (!this.channelSchemaMap.has(eventName)) { // Initialize channel if not already initialized
            this.channelSchemaMap.set(eventName, channel.schema);
            this.channelResponseSchemaMap.set(eventName, channel.responseSchema);
            // Add raw event listener
            this.onRawEvent(eventName, (msg: MessageMeta, sender?: V) => {
                // console.log("Received service message", msg, sender);
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
            // Publish to serverMetaChannel that we are serving this channel
            this.pub(serverMetaChannel, {
                clients: {
                    [this._id]: {
                        services: {
                            [channel.name]: {
                                schema: zodToJsonSchema(channel.schema),
                                responseSchema: (channel.responseSchema === undefined) ? undefined : zodToJsonSchema(channel.responseSchema)
                            }
                        }
                    }
                }
            }, true, false);
        }
    }

    /**
     * Handle response - resolve the promise for the service
     * Common: If the message is for them, they should resolve the promise
     * Server: If the message is for another client, they should forward the message to that client
     */

    /**
     * Handler for receiving service response messages
     * @param channel The channel object that the message was sent on
     * @param msg The message
     * @param sender Optional sender of the message (only used on {@link TopicServer} for broadcasting / forwarding messages)
     */
    protected onReceiveServiceResponseMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceResponseMessage>, sender?: V) {
        const resolver = this.serviceResolvers.get(msg.serviceId);
        const rejector = this.serviceRejectors.get(msg.serviceId);
        if (resolver === undefined || rejector === undefined) {
            console.warn("No resolver or rejector for service id: ", msg.serviceId, ", perhaps the service timed out?");
            return;
        }
        // Verify response schema
        const validResponse = serviceResponseMessageSchema.safeParse(msg).success;
        const validResponseData = channel.responseSchema.safeParse(msg.responseData).success;
        if (!validResponse) {
            rejector(new Error(`Invalid response message schema for service ${channel.name}: ${JSON.stringify(msg)}`));
            return;
        }
        if (!validResponseData) {
            rejector(new Error(`Invalid response schema for service ${channel.name}: ${JSON.stringify(msg)}`));
            return;
        }
        resolver(msg.responseData as U);
    }

    /**
     * Handler for receiving service messages
     * @param channel The channel object that the message was sent on
     * @param msg The message
     * @param sender Optional sender of the message (only used on {@link TopicServer} for broadcasting / forwarding messages)
     */
    protected onReceiveServiceMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceMessage>, sender?: V) {
        // Get the handler
        const eventName = this.getChannelName(channel);
        const handler = this.serviceHandlerMap.get(eventName);
        if (handler === undefined) {
            console.warn(`No handler for channel ${channel.name}`);
            // Dest is now the source, source is now the dest (object's id, which is that be default anyway)
            // this.sendNoServiceHandlerMessage(channel, msg.serviceId, msg.source);
            this.sendServiceErrorMessage(channel, msg.serviceId, "No service handler", msg.source);
        } else {
            // Run the handler
            var result: ServiceResponseType | Promise<ServiceResponseType>;
            try {
                result = handler(msg.serviceData as JSONValue);
            } catch (e) {
                // Send an internal error
                this.sendServiceErrorMessage(channel, msg.serviceId, JSON.stringify(e), msg.source);
            }
            // If the result is a promise, wait for it to resolve
            if (result instanceof Promise) {
                result.then((data) => {
                    // Send the result
                    this.sendServiceResponseMessage(channel, msg.serviceId, data, msg.source)
                }).catch((err) => {
                    // Send an internal error
                    this.sendServiceErrorMessage(channel, msg.serviceId, JSON.stringify(err), msg.source)
                });
            } else {
                // Send the result
                this.sendServiceResponseMessage(channel, msg.serviceId, result, msg.source);
            }
        }
    }

    /**
     * Topic message handler
     * Common behaviour: If you receive a topic message, you should update your topic
     * Server specific behaviour: Directly broadcast the message to all other clients
     */

    /**
     * Handler for receiving topic messages
     * @param channel The channel object that the message was sent on
     * @param msg The message
     * @param sender Optional sender of the message (only used on {@link TopicServer} for broadcasting / forwarding messages)
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
                    // console.log(`${this.id}: 🎊 Topic ${channel.name} is now valid, applying changes`);
                    this.topicsValid.set(eventName, true);
                    this.topicMap.set(eventName, newTopic);
                    this.updateTopic(eventName, newTopic, diffResult, msg);
                    // Instead, iterate over the handlers and their index as pairs, so we can create an unsubscribe function that removes the handler at the correct index
                } else {
                    // console.log(`${this.id}: 🤔 Topic ${channel.name} is still invalid, but applying changes`);
                    // Still update the topic value, but don't call the handler
                    this.topicMap.set(eventName, newTopic);
                }
            } else {
                if (valid) {
                    // console.log(`${this.id}: 😀 Topic ${channel.name} is still valid, applying changes`);
                    // If previously valid and now is still valid, apply the changes
                    this.topicMap.set(eventName, newTopic);
                    this.updateTopic(eventName, newTopic, diffResult, msg);
                } else {
                    // console.log(`${this.id}: 🚨 Topic ${channel.name} is invalid after changes, not applying changes`);
                    // If previously valid and now is invalid, don't apply the changes
                }
            }
            // console.log(`🧓 Old topic:`, currentTopic, `👶 New topic:`, newTopic, `📝 Diff:`, diffResult);
        }
    }

    private createUnsubscriber<T extends JSONValue>(eventName: string, handler: Subscriber<T>) {
        return () => {
            // Remove this handler from the list of handlers
            const handlers = this.topicHandlerMap.get(eventName);
            if (handlers !== undefined) {
                const index = handlers.indexOf(handler as Subscriber<JSONValue>);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        };
    }

    private updateTopic<T extends JSONValue>(eventName: string, newTopic: any, diffResult: DiffResult<T, T>, msg: WithMeta<{ modified?: string | number | boolean | {} | unknown[] | Record<string, unknown> | null | undefined; deleted?: string | number | boolean | {} | unknown[] | Record<string, unknown> | null | undefined; }>) {
        this.lastValidDiffMap.set(eventName, {diff: diffResult, source: msg.source})
        this.topicHandlerMap.get(eventName)?.forEach(handler => {
            const unsubscribe = this.createUnsubscriber(eventName, handler);
            handler(newTopic, unsubscribe, { diff: diffResult, source: msg.source });
        });
    }

    /**
     * Handle request for full topic - send full topic if channel is topic, and we have a valid topic
     * Common behaviour: If you receive a request for full topic, you should send the full topic if you have it
     * Server specific behaviour: Broadcast request for all clients
     */

    /**
     * Handler for receiving request full topic messages
     * @param channel The channel object that the message was sent on
     * @param msg The message
     * @param sender Optional sender of the message (only used on {@link TopicServer} for broadcasting / forwarding messages)
     */
    protected onReceiveRequestFullTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<RequestFullTopicMessage>, sender?: V) {
        if (this.hasValidTopic(channel)) {
            this.sendFullTopic(channel);
        } else {
            // console.warn(`Invalid topic for channel ${channel.name}, sending anyway`);
            this.sendFullTopic(channel);
        }
    }

    /**
     * Publishes a new value to a topic channel by broadcasting the diff between the current value and the new value
     * @param channel The channel to publish to
     * @param data The new value
     * @param updateSelf Whether to call the client's own topic subscribers
     * @param publishDeletes Whether to publish deletions of topic properties (not recommended if multiple clients are publishing to the same topic with overlapping properties)
     * @param source Optional source of the update (Only used on {@link TopicServer} for broadcasting / forwarding messages)
     */
    pub<T extends JSONValue>(channel: TopicChannel<T>, data: RecursivePartial<T>, updateSelf: boolean=true, publishDeletes: boolean=true, source?: string): void {
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        this.initTopicChannel(channel);

        const eventName = this.getChannelName(channel);
        const currentTopic = this.topicMap.get(eventName);
        if (currentTopic === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentTopic as T, data as JSONValue);
        // Disallow deletions of topic properties
        if (!publishDeletes) {
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
                this.onReceiveTopicMessage(channel as TopicChannel<T>, this.wrapMessage(diffResult as JSONObject, "topic", source ?? this._id) as WithMeta<TopicMessage>)
            }
        }
    }


    /**
     * Sends a service request to the specified destination
     * @param channel The channel to send the request on
     * @param serviceData The data to send
     * @param dest The destination to send the request to
     * @param timeout The timeout for the request (in ms)
     * @returns A promise that resolves with the response
     */
    req<T extends RequestType, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, dest: string, serviceData?: T, timeout?: number): Promise<U>;
    req<T extends JSONValue, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, dest: string, serviceData: T, timeout: number = 100): Promise<U> {
        this.initServiceChannel(channel);
        if (channel.mode !== "service") {
            throw new Error("Channel is not a service channel");
        }
        // See if service is valid
        const valid = channel.schema.safeParse(serviceData).success;
        if (!valid) {
            throw new Error("Service data is not valid");
        }
        // Create a unique id for the service request
        const id = uuidv4();
        // Create a promise that resolves when the response is received
        const promise = new Promise<U>((resolve, reject) => {
            // Set a timeout
            const timeoutId = setTimeout(() => {
                reject(new Error("Service timed out"));
            }, timeout);
            // Add the promise to the map
            // console.log("Adding service promise", id);
            this.serviceResolvers.set(id, (result: ServiceResponseType) => {
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
            // console.log("Service promise added", this.serviceResolvers);
        });
        // Send the service request
        this.sendServiceMessage(channel, serviceData, [dest], id);
        return promise;
    }

    /**
     * Sends a service message to the specified destination
     * @param channel The channel to send the request on
     * @param serviceData The data to send
     * @param dest The destination to send the request to
     * @param serviceID The service ID to use
     */
    protected sendServiceMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, serviceData: T, dest: DestType, serviceID: string) {
        if (channel.mode !== "service") {
            throw new Error("Channel is not a service channel");
        }
        const msg: ServiceMessage = {
            serviceId: serviceID,
            dest,
            // Only return serviceData if it it not undefined
            ...(serviceData !== undefined ? {serviceData} : {})
        }
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(msg as JSONObject, "service"), dest);
    }

    /**
     * Gets a topic channel's current value regardless of whether it is valid or not
     * @param channel The channel to get the value of
     * @returns The current value of the topic channel
     * @throws Error if the channel is not a topic channel
     */
    protected _getUnsafeTopic<T extends JSONValue>(channel: Channel<T>): RecursivePartial<T> {
        const channelName = this.getChannelName(channel);
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        const currentTopic = this.topicMap.get(channelName);
        if (currentTopic === undefined) {
            throw new Error(`Topic ${channel.name} not found`);
        }
        return currentTopic as RecursivePartial<T>;
    }

    /**
     * Gets a topic channel's current value
     * @param channel The channel to get the value of
     * @returns The current value of the topic channel
     * @throws Error if the channel is not a topic channel, not found, or not valid
     */
    getTopicSync<T extends JSONValue>(channel: TopicChannel<T>): T {
        const channelName = this.getChannelName(channel);
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        const currentTopic = this.topicMap.get(channelName);
        if (currentTopic === undefined) {
            throw new Error(`Topic ${channel.name} not found`);
        }
        if (!this.topicsValid.get(channelName)) {
            throw new Error("Topic is not valid");
        }
        return currentTopic as T;
    }

    /**
     * Gets a promise that resolves with a topic channel's value (waits for a value before resolving)
     * @param channel The channel to get the value of
     * @param timeout The timeout for the request (in ms)
     * @returns A promise that resolves with the topic channel's value
     */
    getTopic<T extends JSONValue>(channel: TopicChannel<T>, timeout: number=100): Promise<T> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error("Topic timed out"));
            }, timeout);
            var timedOut = false;
            const unsub = this.sub(channel, (topic) => {
                if (!timedOut) {
                    clearTimeout(timeoutId);
                    resolve(topic);
                }
                unsub();
            });
        });
    }

    /**
     * Lists all clients connected to the server
     * @returns An array of client IDs
     */
    listClients(): string[] {
        // Read off of serverMetaChannel
        try {
            const serverMeta = this.getTopicSync(serverMetaChannel);
            if (serverMeta.clients === undefined) {
                return [];
            } else {
                // Get keys
                return Object.keys(serverMeta.clients);
            }
        } catch (e) {
            return [];
        }
    }

    // TODO:
    // - listClientsSync
    // - listClients
    // - listServicesSync
    // - listServices

    // TODO: We need a way to unsubscribe from a topic soon, but for now we can just use this. This will leak memory if we repeatedly call it.
    /**
     * Gets a promise that resolves with the server ID
     * @returns A promise that resolves with the server ID
     */
    getServerID(): Promise<string> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Server ID timed out"));
            }, 10000);
            var resolved = false;
            const handler = (topic: ServerMeta) => {
                if (topic.serverID !== undefined && !resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(topic.serverID);
                }
            }
            this.sub(serverMetaChannel, handler);
        });
    }

    /**
     * Gets the client ID
     */
    get id(): string {
        return this._id;
    }
}