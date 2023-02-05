import { z } from "zod";
import { Channel } from "./Channel";
import { diff, DiffResult, mergeDiff, RecursivePartial } from "./Compare";
import { metaMessageSchema, MessageMeta, requestFullStateMessage, stateMessageSchema, requestFullStateMessageSchema, StateMessage, WithMeta, MessageType } from "../messages/Messages";
import { JSONObject, JSONValue } from "./State";
import { Socket } from "socket.io";

// TODO: Can add deletion! We need to intelligently merge the state on the server to make sure there are no delete conflicts
// Then, we can send the diff to all the clients
// We need a seperate message type called "set" though, and this will remove all hope of decentralization unfortunately
// But it will be hard to decentralize if we need to do it through the internet anyway so it's not that bad!
// Just changes the application of the library

export const channelPrefix = "ch-";

type SocketClient = {
    emit: (event: string, ...args: any[]) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
}

export type OnReceiveStateMessageArgs<T extends JSONValue> = {
    sender?: Socket;
    message: WithMeta<StateMessage>, valid: boolean, diffResult: DiffResult<T, T>, fullState: RecursivePartial<T>
}

export type OnReceiveRequestFullStateMessageArgs<T> = {
    sender?: Socket;
    message: WithMeta<requestFullStateMessage>, alreadyHasFullState: boolean
}

export abstract class BaseStateClient {
    protected abstract socket: SocketClient;
    protected channelMap: Map<string, z.ZodSchema<JSONValue>> = new Map();
    protected stateMap: Map<string, JSONValue> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected statesValid: Map<string, boolean> = new Map();
    protected id: string;

    // Abstract methods
    protected abstract setSocketHandler(event: string, listener: (data: any, sender?: Socket) => void): void;
    abstract sendRequestFullState<T extends JSONValue>(channel: Channel<T>): void;
    abstract sendDiffState<T extends JSONValue>(channel: Channel<T>, diffResult: DiffResult<T, T>): void;

    // Default constructor
	constructor() {
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
    protected wrapStateMessage(rawMessage: JSONObject, messageType: MessageType): MessageMeta {
        return {...rawMessage, timestamp: Date.now(), messageType};
    }

    protected sendRawStateMessage<T extends JSONValue>(channel: Channel<T>, message: DiffResult<T, T>) {
        this.socket.emit(this.getChannelName(channel), this.wrapStateMessage(message as JSONObject, "state"));
    }

    sendFullState<T extends JSONValue>(channel: Channel<T>): void {
        // Try to get full state from channel
        const fullState = this.getState(channel);
        if (fullState === undefined) {
            console.warn(`Cannot send full state for channel ${channel.name} - no full state available`);
            return;
        } else {
            this.sendDiffState(channel, {
                // @ts-ignore - this is a valid state, but the type system doesn't know that
                modified: fullState
            });
        }
    }

    addStateChannel<T extends JSONValue>(channel: Channel<T>, onStateChange?: (state: T) => void, 
        onReceiveStateMessage?: (args: OnReceiveStateMessageArgs<T>) => void,
        onReceiveRequestFullStateMessage?: (args: OnReceiveRequestFullStateMessageArgs<T>) => void
        ): void {
        // Initialize channel
        const eventName = this.getChannelName(channel);
        this.channelMap.set(eventName, channel.schema);
        this.stateMap.set(eventName, {});
        // Add handler
        this.setSocketHandler(eventName, (message: MessageMeta, sender?: Socket) => {
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
                    sender
                });
                return;
            } 
            
            // Handle state update
            if (message.messageType === "state") {
                // See if we have the state initialized. It should, because we need to initalize it before we can receive updates.
                const currentState = this.stateMap.get(eventName);
                if (currentState === undefined) {
                    throw new Error("Channel not found. This should not happen.");
                }
                // Cast the message to the correct type
                const diffResult = message as unknown as DiffResult<T, T>;
                // Update the state
                const newState = mergeDiff(currentState, diffResult);
                // See if the new state is valid according to the state schema
                const valid = channel.schema.safeParse(currentState).success;
                // Update the state validity and value, and call the handler if it is valid and if there are any changes
                if (valid) {
                    this.statesValid.set(eventName, true);
                    // Call the handler if there are any changes
                    if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
                        this.stateMap.set(eventName, newState);
                        onStateChange?.(newState);
                    }
                } else {
                    this.statesValid.set(eventName, false);
                }
                onReceiveStateMessage?.({
                    message: message as unknown as WithMeta<StateMessage>,
                    valid: valid,
                    diffResult: diffResult,
                    fullState: currentState as RecursivePartial<T>,
                    sender
                });
                return;
            }

            console.warn("Unrecognized message type for message: ", message);
        });
    }

    // Not recommended for use with allowDeletions since multiple clients can accidentally overwrite each other's state
    // Only use if you are sure that the state is not being updated by other clients
    _setState<T extends JSONValue>(channel: Channel<T>, state: T, allowDeletions: boolean = false) {
        const currentState = this.stateMap.get(channelPrefix+channel.name);
        if (currentState === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentState as T, state);
        // Disallow deletions of state properties
        diffResult.deleted = undefined;
        // Only emit if there are changes
        if (diffResult.modified !== undefined || diffResult.deleted !== undefined) {
            this.stateMap.set(channelPrefix+channel.name, state);
            this.sendDiffState(channel, diffResult);
        }
    }

    updateState<T extends JSONValue>(channel: Channel<T>, state: T) {
        this._setState(channel, state);
    }

    getState<T extends JSONValue>(channel: Channel<T>): T {
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