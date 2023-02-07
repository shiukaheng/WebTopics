import { z } from "zod";
import { Channel } from "./Channel";
import { diff, DiffResult, mergeDiff, RecursivePartial } from "./Compare";
import { metaMessageSchema, MessageMeta, requestFullStateMessage, stateMessageSchema, requestFullStateMessageSchema, StateMessage, WithMeta, MessageType } from "../messages/Messages";
import { JSONObject, JSONValue } from "./JSON";

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
    message: WithMeta<requestFullStateMessage>, alreadyHasFullState: boolean
}

export type DestType = string[] | "*";

export abstract class BaseStateClient<V = void> {
    protected channelMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected channelHandlersMap: Map<string, ((state: JSONValue) => void)[]> = new Map();
    protected stateMap: Map<string, JSONValue> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected statesValid: Map<string, boolean> = new Map();
    protected id: string; // Unused for now

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
    protected wrapMessage(rawMessage: JSONObject, messageType: MessageType, dest?: DestType, source?: string[]): MessageMeta {
        return {...rawMessage, timestamp: Date.now(), messageType, source: source ?? [this.id], dest: dest ?? "*"};
    }

    protected sendStateMessage<T extends JSONValue>(channel: Channel<T>, diff: DiffResult<T, T>, dest?: DestType, source?: string[]): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage(diff as JSONObject, "state", dest, source));
    }

    sendDiffState<T extends JSONValue>(channel: Channel<T>, diffResult: DiffResult<T, T>, dest?: DestType, source?: string[]): void {
        this.sendStateMessage(channel, diffResult as JSONObject, dest, source);
    }

    sendFullState<T extends JSONValue>(channel: Channel<T>, dest?: DestType, source?: string[]): void {
        // Try to get full state from channel
        const fullState = this.getState(channel);
        if (fullState === undefined) {
            console.warn(`Cannot send full state for channel ${channel.name} - no full state available`);
            return;
        } else {
            this.sendDiffState(channel, {
                // @ts-ignore - this is a valid state, but the type system doesn't know that
                modified: fullState
            }, source, dest);
        }
    }

    sendRequestFullState<T extends JSONValue>(channel: Channel<T>, dest?: DestType, source?: string[]): void {
        this.emitRawEvent(this.getChannelName(channel), this.wrapMessage({}, "requestFullState", dest, source));
    }

    sub<T extends JSONValue>(channel: Channel<T>, onStateChange?: (state: T) => void, 
        onReceiveStateMessage?: (args: OnReceiveStateMessageArgs<T, V>) => void,
        onReceiveRequestFullStateMessage?: (args: OnReceiveRequestFullStateMessageArgs<V>) => void
        ): void {
        // Initialize channel
        const eventName = this.getChannelName(channel);
        if (!this.channelMap.has(eventName)) {
            this.channelMap.set(eventName, channel.schema);
            this.stateMap.set(eventName, {});
            if (this.channelHandlersMap.has(eventName) === false) {
                this.channelHandlersMap.set(eventName, []);
            }
            // Add raw event listener
            this.onRawEvent(eventName, (message: MessageMeta, sender: V) => {
                // Validate the message - in the sense that it is a valid message type, but doesn't guarantee that the state is valid
                const validMessage = metaMessageSchema.safeParse(message).success;
                if (!validMessage) {
                    console.warn("Invalid message received: ", message);
                    return;
                }
                metaMessageSchema.parse(message);
                // Handle request for full state
                if (message.messageType === "requestFullState") {
                    if (this.hasValidState(channel)) {
                        this.sendFullState(channel);
                    } else {
                        console.warn(`Invalid state for channel ${channel.name} - cannot send full state`);
                    }
                    onReceiveRequestFullStateMessage?.({
                        message: message as unknown as WithMeta<requestFullStateMessage>,
                        alreadyHasFullState: this.hasValidState(channel),
                        socket: sender
                    });
                    return;
                } 
                // Handle state update
                if (message.messageType === "state") {
                    // See if we have the state initialized. It should, because we need to initalize it before we can receive updates.
                    const currentState = this.stateMap.get(eventName);
                    // console.log(eventName, currentState);
                    if (this.stateMap.has(eventName) === false) {
                        throw new Error(`State for channel ${channel.name} not initialized`);
                    };
                    // Cast the message to the correct type
                    const diffResult = message as unknown as DiffResult<T, T>;
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
                            this.channelHandlersMap.get(eventName)?.forEach(handler => handler(newState));
                        }
                    } else {
                        this.statesValid.set(eventName, false);
                    }
                    onReceiveStateMessage?.({
                        message: message as unknown as WithMeta<StateMessage>,
                        valid: valid,
                        diffResult: diffResult,
                        fullState: currentState as RecursivePartial<T>,
                        socket: sender
                    });
                    return;
                }
                // Handle command
                if (message.messageType === "command") {
                    // TODO:
                    // Run the handler, which is supposed to give a response that matches the response schema
                    // The handler could be async.
                    // Once the handler is done, validate the response and send it back to the sender using the same command id
                }
                // Handle response
                if (message.messageType === "commandResponse") {
                    // TODO:
                    // Check if there is a pending command with the same id (we probably need a set for this)
                    // If there is, validate the response and resolve the promise
                    // If there isn't, ignore the response and log a warning
                }
                console.warn("Unrecognized message type for message: ", message);
            });
        }
        // Add handler
        if (onStateChange !== undefined) {
            this.channelHandlersMap.get(eventName)?.push(onStateChange as (state: JSONValue) => void);
        }
    }

    unsub<T extends JSONValue>(channel: Channel<T>, onStateChange?: (state: T) => void): void {
        const eventName = this.getChannelName(channel);
        if (onStateChange !== undefined) {
            const handlers = this.channelHandlersMap.get(eventName);
            if (handlers !== undefined) {
                const index = handlers.indexOf(onStateChange as (state: JSONValue) => void);
                if (index !== -1) {
                    handlers.splice(index, 1);
                }
            }
        }
    }

    // Not recommended for use with allowDeletions since multiple clients can accidentally overwrite each other's state
    // Only use if you are sure that the state is not being updated by other clients
    _set<T extends JSONValue>(channel: Channel<T>, state: T, allowDeletions: boolean = false, dest?: DestType, source?: string[]): void {
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
            this.sendDiffState(channel, diffResult, dest, source);
            if (this.selfSubscribed) {
                this.channelHandlersMap.get(channelPrefix+channel.name)?.forEach(handler => handler(state));
            }
        }
    }

    pub<T extends JSONValue>(channel: Channel<T>, state: T, dest?: DestType, source?: string[],): void {
        this._set(channel, state, false, dest, source);
    }

    protected getState<T extends JSONValue>(channel: Channel<T>): T {
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