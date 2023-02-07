import { z } from "zod";
import { Channel, CommandChannel, StateChannel } from "./Channel";
import { diff, DiffResult, mergeDiff, RecursivePartial } from "./Compare";
import { metaMessageSchema, MessageMeta, RequestFullStateMessage, stateMessageSchema, requestFullStateMessageSchema, StateMessage, WithMeta, MessageType, CommandMessage, commandMessageSchema, CommandResponseMessage, commandResponseMessageSchema } from "../messages/Messages";
import { JSONObject, JSONValue } from "./JSON";
import { v4 as uuidv4 } from 'uuid';

// TODO: Can add deletion feature. We need to intelligently merge the state on the server to make sure there are no delete conflicts
// Then, we can send the diff to all the clients
// We need a seperate message type called "set" though, and this will remove all hope of decentralization unfortunately
// But it will be hard to decentralize if we need to do it through the internet anyway so it's not that bad!
// Just changes the application of the library

export const channelPrefix = "ch-";

export type OnReceiveStateMessageArgs<T extends JSONValue, V = void> = {
    socket?: V;
    message: WithMeta<StateMessage>, valid: boolean, diffResult: DiffResult<T, T>, fullState: RecursivePartial<T>
}

export type OnReceiveRequestFullStateMessageArgs<V = void> = {
    socket?: V;
    message: WithMeta<RequestFullStateMessage>, alreadyHasFullState: boolean
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

export abstract class BaseStateClient<V = void> {
    protected channelSchemaMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected channelResponseSchemaMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected stateHandlerMap: Map<string, ((value: JSONValue) => void)[]> = new Map();
    protected stateMap: Map<string, JSONValue> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected statesValid: Map<string, boolean> = new Map();
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
    protected abstract emitRawEvent(event: string, data: any): void;

    // Default constructor
	constructor(selfSubscribed: boolean = true) {
        this.selfSubscribed = selfSubscribed;
        this.id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	}

    // Helper / convenience methods
    protected getChannelName<T extends JSONValue>(channel: Channel<T>): string {
        return channelPrefix+channel.name;
    }

    hasValidState<T extends JSONValue>(channel: Channel<T>): boolean {
        return this.statesValid.get(this.getChannelName(channel)) ?? false;
    }

    // Messages
    protected wrapMessage(rawMessage: JSONObject, messageType: MessageType, source?: string): MessageMeta {
        return {...rawMessage, timestamp: Date.now(), messageType, source: source ?? this.id};
    }

    protected sendStateMessage<T extends JSONValue>(channel: StateChannel<T>, diff: DiffResult<T, T>, source?: string): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(diff as JSONObject, "state", source));
    }

    sendDiffState<T extends JSONValue>(channel: StateChannel<T>, diffResult: DiffResult<T, T>, source?: string): void {
        this.sendStateMessage(channel, diffResult as JSONObject, source);
    }

    sendFullState<T extends JSONValue>(channel: StateChannel<T>, source?: string): void {
        // Try to get full state from channel
        const fullState = this.getState(channel);
        if (fullState === undefined) {
            console.warn(`Cannot send full state for channel ${channel.name} - no full state available`);
            return;
        } else {
            this.sendDiffState(channel, {
                // @ts-ignore - this is a valid state, but the type system doesn't know that
                modified: fullState
            }, source);
        }
    }

    sendRequestFullState<T extends JSONValue>(channel: StateChannel<T>, source?: string): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({}, "requestFullState", source));
    }

    sendNoCommandHandlerMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, id: string, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            commandId: id,
            dest,
            noCommandHandler: true
        }, "commandResponse"));
    }
    sendCommandResponseMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, id: string, result: JSONValue, dest: string) {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({
            responseData: result,
            commandId: id,
            dest
        }, "commandResponse"));
    }

    sub<T extends JSONValue>(channel: StateChannel<T>, handler?: (state: T) => void): void {
        if (channel.mode !== "state") throw new Error("Channel is not a state channel");
        const eventName = this.getChannelName(channel);
        if (!this.channelSchemaMap.has(eventName)) { // Initialize channel if not already initialized
            this.stateMap.set(eventName, {});
            if (this.stateHandlerMap.has(eventName) === false) {
                this.stateHandlerMap.set(eventName, []);
            }
            // Add raw event listener
            this.onRawEvent(eventName, (msg: MessageMeta, sender: V) => {
                // Validate the message - in the sense that it is a valid message type, but doesn't guarantee that the state is valid
                const validMessage = metaMessageSchema.safeParse(msg).success;
                if (!validMessage) {
                    console.warn("Invalid message received: ", msg);
                    return;
                }
                metaMessageSchema.parse(msg);
                if (msg.messageType === "requestFullState" && requestFullStateMessageSchema.safeParse(msg).success) {
                    this.onReceiveRequestFullStateMessage<T>(channel, msg as WithMeta<RequestFullStateMessage>, sender);
                    return;
                } 
                if (msg.messageType === "state" && stateMessageSchema.safeParse(msg).success) {
                    this.onReceiveStateMessage<T>(channel, msg as WithMeta<StateMessage>, sender);
                    return;
                }
                console.warn("Unrecognized message type for message: ", msg, stateMessageSchema.parse(msg));
            });
        }
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            this.stateHandlerMap.get(eventName)?.push(handler as (state: JSONValue) => void);
        }
    }

    serve<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, handler?: (state: T) => U): void {
        if (channel.mode !== "command") throw new Error("Channel is not a command channel");
        // Initialize channel
        const eventName = this.getChannelName(channel);
        const channelType = channel.mode;
        if (!this.channelSchemaMap.has(eventName)) { // Initialize channel if not already initialized
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
                }
                if (msg.messageType === "command" && commandMessageSchema.safeParse(msg).success) {
                    this.onReceiveCommandMessage<T, U>(channel, msg as WithMeta<CommandMessage>, sender);
                }
                console.warn("Unrecognized message type for message: ", msg);
            });
        }
        this.channelSchemaMap.set(eventName, channel.schema);
        if (handler !== undefined) {
            this.commandHandlerMap.set(eventName, handler as (command: JSONValue) => U);
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
            resolver(msg.responseData as U);
        }
    }

    protected onReceiveCommandMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, msg: WithMeta<CommandMessage>, sender: V) {
        // Get the handler
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
     * State message handler
     * Common behaviour: If you receive a state message, you should update your state
     * Server specific behaviour: Directly broadcast the message to all other clients
     */
    protected onReceiveStateMessage<T extends JSONValue>(channel: StateChannel<T>, msg: WithMeta<StateMessage>, sender: V) {
        // See if we have the state initialized. It should, because we need to initalize it before we can receive updates.
        const eventName = this.getChannelName(channel);
        const currentState = this.stateMap.get(eventName);
        // console.log(eventName, currentState);
        if (this.stateMap.has(eventName) === false) {
            throw new Error(`State for channel ${channel.name} not initialized`);
        };
        // Cast the message to the correct type
        const diffResult = msg as unknown as DiffResult<T, T>;
        // Update the state
        const newState = mergeDiff(currentState, diffResult);
        // See if the new state is valid according to the state schema
        const valid = channel.schema.safeParse(newState).success;
        // Update the state validity and value, and call the handler if it is valid and if there are any changes
        if (valid) {
            this.statesValid.set(eventName, true);
            // Call the handler if there are any changes
            if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
                this.stateMap.set(eventName, newState);
                this.stateHandlerMap.get(eventName)?.forEach(handler => handler(newState));
            }
        } else {
            this.statesValid.set(eventName, false);
        }
    }

    /**
     * Handle request for full state - send full state if channel is state, and we have a valid state
     * Common behaviour: If you receive a request for full state, you should send the full state if you have it
     * Server specific behaviour: Broadcast request for all clients
     */
    protected onReceiveRequestFullStateMessage<T extends JSONValue>(channel: StateChannel<T>, msg: WithMeta<RequestFullStateMessage>, sender: V) {
        if (this.hasValidState(channel)) {
            this.sendFullState(channel);
        } else {
            console.warn(`Invalid state for channel ${channel.name} - cannot send full state`);
        }
    }

    // Not recommended for use with allowDeletions since multiple clients can accidentally overwrite each other's state
    // Only use if you are sure that the state is not being updated by other clients
    _set<T extends JSONValue>(channel: Channel<T>, state: T, allowDeletions: boolean = false, source?: string): void {
        const currentState = this.stateMap.get(channelPrefix+channel.name);
        if (currentState === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentState as T, state);
        // Disallow deletions of state properties
        if (!allowDeletions) {
            diffResult.deleted = undefined;
        }
        // Only emit if there are changes
        if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
            this.stateMap.set(channelPrefix+channel.name, state);
            this.sendDiffState(channel as StateChannel<T>, diffResult, source);    
            if (this.selfSubscribed) {
                this.stateHandlerMap.get(channelPrefix+channel.name)?.forEach(handler => handler(state));
            }
        }
    }

    pub<T extends JSONValue>(channel: StateChannel<T>, state: T, source?: string,): void {
        if (channel.mode !== "state") {
            throw new Error("Channel is not a state channel");
        }
        this._set(channel, state, false, source);
    }

    req<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, commandData: T, dest: DestType, timeout: number=10000): Promise<U> {
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
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(msg as JSONObject, "command"));
        return id;
    }

    protected getState<T extends JSONValue>(channel: Channel<T>): T {
        if (channel.mode !== "state") {
            throw new Error("Channel is not a state channel");
        }
        const currentState = this.stateMap.get(channelPrefix+channel.name);
        if (currentState === undefined) {
            throw new Error("Channel not found");
        }
        if (!this.statesValid.get(channelPrefix+channel.name)) {
            throw new Error("State is not valid");
        }
        return currentState as T;
    }
}