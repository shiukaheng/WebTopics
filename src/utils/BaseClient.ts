import { z } from "zod";
import { Channel, CommandChannel, TopicChannel } from "./Channel";
import { diff, DiffResult, mergeDiff, RecursivePartial } from "./Compare";
import { metaMessageSchema, MessageMeta, RequestFullTopicMessage, topicMessageSchema, requestFullTopicMessageSchema, TopicMessage, WithMeta, MessageType, CommandMessage, commandMessageSchema, CommandResponseMessage, commandResponseMessageSchema } from "../messages/Messages";
import { JSONObject, JSONValue } from "./JSON";
import { v4 as uuidv4 } from 'uuid';

export const channelPrefix = "ch-";

export type OnReceiveTopicMessageArgs<T extends JSONValue, V = void> = {
    socket?: V;
    message: WithMeta<TopicMessage>, valid: boolean, diffResult: DiffResult<T, T>, fullTopic: RecursivePartial<T>
}

export type OnReceiveRequestFullTopicMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<RequestFullTopicMessage>, alreadyHasFullTopic: boolean
}

export type OnReceiveCommandMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<CommandMessage>, valid: boolean
}

export type OnReceiveCommandResponseMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<CommandMessage>, valid: boolean
}

export type DestType = string[] | "*";

export abstract class BaseClient<V = void> {
    protected channelSchemaMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected channelResponseSchemaMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected topicHandlerMap: Map<string, ((value: JSONValue) => void)[]> = new Map();
    protected topicMap: Map<string, JSONValue> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected topicsValid: Map<string, boolean> = new Map();
    protected commandHandlerMap: Map<string, (data: JSONValue) => JSONValue> = new Map();
    protected id: string;
    protected commandResolvers: Map<string, (data: JSONValue) => void> = new Map();
    protected commandRejectors: Map<string, (reason: any) => void> = new Map();

    /**
     * Whether the client subscribes get called from its own publishes
     */
    selfSubscribed: boolean;

    // Abstract methods
    protected abstract onRawEvent(event: string, listener: (data: any, sender: V) => void): void; // On an event, with the option to specify the sender (for differentiating where the message came from), but only used optionally per implementation
    protected abstract emitRawEvent(event: string, data: any, destination: DestType): void;

    // Default constructor
	constructor(selfSubscribed: boolean = true) {
        this.selfSubscribed = selfSubscribed;
        this.id = uuidv4();
	}

    // Helper / convenience methods
    protected getChannelName<T extends JSONValue>(channel: Channel<T>): string {
        return channelPrefix+channel.name;
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
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({}, "requestFullTopic", source), "*");
    }

    sendNoCommandHandlerMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, id: string, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            commandId: id,
            dest,
            noCommandHandler: true
        }, "commandResponse"), [dest]);
    }
    sendCommandResponseMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, id: string, result: JSONValue, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            responseData: result,
            commandId: id,
            dest
        }, "commandResponse"), [dest]);
    }

    sub<T extends JSONValue>(channel: TopicChannel<T>, handler?: (topic: T) => void): void {
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
        }
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            this.topicHandlerMap.get(eventName)?.push(handler as (topic: JSONValue) => void);
        }
    }

    serve<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, handler?: (topic: T) => U): void {
        if (channel.mode !== "command") throw new Error("Channel is not a command channel");
        // Initialize channel
        const eventName = this.getChannelName(channel);
        const channelType = channel.mode;
        this.listenCommandChannel(channel);
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            this.commandHandlerMap.set(eventName, handler as (command: JSONValue) => U);
        }
    }

    private listenCommandChannel<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>) {
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
                if (msg.messageType === "commandResponse" && commandResponseMessageSchema.safeParse(msg).success) {
                    this.onReceiveCommandResponseMessage<T, U>(channel, msg as WithMeta<CommandResponseMessage>, sender);
                    return;
                }
                if (msg.messageType === "command" && commandMessageSchema.safeParse(msg).success) {
                    this.onReceiveCommandMessage<T, U>(channel, msg as WithMeta<CommandMessage>, sender);
                    return;
                }
                console.warn(`Invalid message received for command channel ${channel.name}:`, msg);
            });
        }
    }

    /**
     * Handle response - resolve the promise for the command
     * Common: If the message is for them, they should resolve the promise
     * Server: If the message is for another client, they should forward the message to that client
     */
    protected onReceiveCommandResponseMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, msg: WithMeta<CommandResponseMessage>, sender: V) {
        const resolver = this.commandResolvers.get(msg.commandId);
        const rejector = this.commandRejectors.get(msg.commandId);
        if (resolver === undefined || rejector === undefined) {
            console.warn("No resolver or rejector for command id: ", msg.commandId, ", perhaps the command timed out?");
            return;
        }
        if (msg.noHandler) {
            rejector(new Error("No command handler"));
        } else {
            // console.log("Resolving command promise");
            resolver(msg.responseData as U);
        }
    }

    protected onReceiveCommandMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, msg: WithMeta<CommandMessage>, sender: V) {
        // Get the handler
        // console.log("Received command message: ", msg);
        const eventName = this.getChannelName(channel);
        const handler = this.commandHandlerMap.get(eventName);
        if (handler === undefined) {
            console.warn(`No handler for channel ${channel.name}`);
            // Dest is now the source, source is now the dest (object's id, which is that be default anyway)
            this.sendNoCommandHandlerMessage(channel, msg.commandId, msg.source);
        } else {
            // Run the handler
            const result = handler(msg.commandData as JSONValue);
            // Send the result
            this.sendCommandResponseMessage(channel, msg.commandId, result, msg.source);
        }
    }

    /**
     * Topic message handler
     * Common behaviour: If you receive a topic message, you should update your topic
     * Server specific behaviour: Directly broadcast the message to all other clients
     */
    protected onReceiveTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<TopicMessage>, sender: V) {
        // See if we have the topic initialized. It should, because we need to initalize it before we can receive updates.
        const eventName = this.getChannelName(channel);
        const currentTopic = this.topicMap.get(eventName);
        // console.log(eventName, currentTopic);
        if (this.topicMap.has(eventName) === false) {
            throw new Error(`Topic for channel ${channel.name} not initialized`);
        };
        // Cast the message to the correct type
        const diffResult = msg as unknown as DiffResult<T, T>;
        // Update the topic
        const newTopic = mergeDiff(currentTopic, diffResult);
        // See if the new topic is valid according to the topic schema
        const valid = channel.schema.safeParse(newTopic).success;
        // Update the topic validity and value, and call the handler if it is valid and if there are any changes
        if (valid) {
            this.topicsValid.set(eventName, true);
            // Call the handler if there are any changes
            if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
                this.topicMap.set(eventName, newTopic);
                this.topicHandlerMap.get(eventName)?.forEach(handler => handler(newTopic));
            }
        } else {
            this.topicsValid.set(eventName, false);
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
            console.warn(`Invalid topic for channel ${channel.name} - cannot send full topic`);
        }
    }

    // Not recommended for use with allowDeletions since multiple clients can accidentally overwrite each other's topic
    // Only use if you are sure that the topic is not being updated by other clients
    _set<T extends JSONValue>(channel: Channel<T>, topic: T, allowDeletions: boolean = false, source?: string): void {
        const currentTopic = this.topicMap.get(channelPrefix+channel.name);
        if (currentTopic === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentTopic as T, topic);
        // Disallow deletions of topic properties
        if (!allowDeletions) {
            diffResult.deleted = undefined;
        }
        // Only emit if there are changes
        if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
            this.topicMap.set(channelPrefix+channel.name, topic);
            this.sendDiffTopic(channel as TopicChannel<T>, diffResult, source);    
            if (this.selfSubscribed) {
                this.topicHandlerMap.get(channelPrefix+channel.name)?.forEach(handler => handler(topic));
            }
        }
    }

    pub<T extends JSONValue>(channel: TopicChannel<T>, topic: T, source?: string,): void {
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        this._set(channel, topic, false, source);
    }

    req<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, commandData: T, dest: DestType, timeout: number=10000): Promise<U> {
        // console.log(Date.now())
        this.listenCommandChannel(channel);
        if (channel.mode !== "command") {
            throw new Error("Channel is not a command channel");
        }
        // See if command is valid
        const valid = channel.schema.safeParse(commandData).success;
        if (!valid) {
            throw new Error("Command data is not valid");
        }
        // Send the command
        const id = this.sendCommandMessage(channel, commandData, dest);
        // Create a promise that resolves when the response is received
        return new Promise((resolve, reject) => {
            // Set a timeout
            const timeoutId = setTimeout(() => {
                reject(new Error("Command timed out"));
            }, timeout);
            // Add the promise to the map
            this.commandResolvers.set(id, (result: JSONValue) => {
                clearTimeout(timeoutId);
                this.commandResolvers.delete(id);
                this.commandRejectors.delete(id);
                resolve(result as U);
            })
            this.commandRejectors.set(id, (reason: any) => {
                clearTimeout(timeoutId);
                this.commandResolvers.delete(id);
                this.commandRejectors.delete(id);
                reject(reason);
            })
        });
    }

    sendCommandMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, commandData: T, dest: DestType): string {
        if (channel.mode !== "command") {
            throw new Error("Channel is not a command channel");
        }
        const id = uuidv4();
        const msg: CommandMessage = {
            commandData,
            commandId: id,
            dest,
        }
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(msg as JSONObject, "command"), dest);
        return id;
    }

    protected getTopic<T extends JSONValue>(channel: Channel<T>): T {
        if (channel.mode !== "topic") {
            throw new Error("Channel is not a topic channel");
        }
        const currentTopic = this.topicMap.get(channelPrefix+channel.name);
        if (currentTopic === undefined) {
            throw new Error("Channel not found");
        }
        if (!this.topicsValid.get(channelPrefix+channel.name)) {
            throw new Error("Topic is not valid");
        }
        return currentTopic as T;
    }
}