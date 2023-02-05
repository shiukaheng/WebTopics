import { z } from "zod";
import { Channel } from "./Channel";
import { diff, DiffResult, mergeDiff, mergeDiffInPlace, RecursivePartial } from "./Compare";
import { baseMetaMessageSchema, BaseMetaMessage, BaseRequestFullStateMessage, baseStateMessageSchema, baseRequestFullStateMessageSchema, BaseStateMessage, WithBaseMeta } from "../messages/BaseMessages";
import { JSONObject } from "./State";
import { Socket } from "socket.io";

// Could do some refactoring so base state client does not need to know about socket.io

export const channelPrefix = "ch-";

type SocketClient = {
    emit: (event: string, ...args: any[]) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
}

type BaseMessageTypes = "requestFullState" | "state" | null;

export type OnReceiveStateMessageArgs<T> = {
    sender?: Socket;
    message: WithBaseMeta<BaseStateMessage>, valid: boolean, diffResult: DiffResult<T>, fullState: RecursivePartial<T>
}

export type OnReceiveRequestFullStateMessageArgs<T> = {
    sender?: Socket;
    message: WithBaseMeta<BaseRequestFullStateMessage>, alreadyHasFullState: boolean
}

export abstract class BaseStateClient {
    protected abstract socket: SocketClient;
    protected channelMap: Map<string, z.ZodSchema<JSONObject>> = new Map();
    protected stateMap: Map<string, JSONObject> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected statesValid: Map<string, boolean> = new Map();
    protected id: string;

	constructor() {
        this.id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	}

    protected wrapStateMessage<T extends JSONObject>(rawMessage: JSONObject): BaseMetaMessage {
        return {...rawMessage, timestamp: Date.now()};
    }

    protected sendRawStateMessage<T extends JSONObject>(channel: Channel<T>, message: JSONObject) {
        this.socket.emit(this.getChannelName(channel), this.wrapStateMessage(message));
        console.log(`Sent state message to channel ${channel.name}: ${JSON.stringify(message)} from client ${this.id}`);
    }

    protected getChannelName<T extends JSONObject>(channel: Channel<T>): string {
        return channelPrefix+channel.name;
    }
    
    hasValidState<T extends JSONObject>(channel: Channel<T>): boolean {
        return this.statesValid.get(this.getChannelName(channel)) ?? false;
    }

    protected abstract setSocketHandler(event: string, listener: (data: any, sender?: Socket) => void): void;

    abstract sendRequestFullState<T extends JSONObject>(channel: Channel<T>): void;
    abstract sendDiffState<T extends JSONObject>(channel: Channel<T>, diffResult: DiffResult<T>): void;

    sendFullState<T extends JSONObject>(channel: Channel<T>): void {
        // Try to get full state from channel
        const fullState = this.getState(channel);
        if (fullState === undefined) {
            console.warn(`Cannot send full state for channel ${channel.name} - no full state available`);
            return;
        } else {
            this.sendDiffState(channel, {
                // @ts-ignore - this is a valid state, but the type system doesn't know that
                modified: fullState,
                // @ts-ignore - same as above
                deleted: {}
            });
        }
    }

    protected getMessageType(message: BaseMetaMessage): BaseMessageTypes {
        if (!baseMetaMessageSchema.safeParse(message).success) {
            return null;
        }
        // Use the schema to determine the message type
        if (baseStateMessageSchema.safeParse(message).success) {
            return "state";
        } else if (baseRequestFullStateMessageSchema.safeParse(message).success) {
            return "requestFullState";
        }
        return null;
    }

    addStateChannel<T extends JSONObject>(channel: Channel<T>, onStateChange?: (state: T) => void, 
        onReceiveStateMessage?: (args: OnReceiveStateMessageArgs<T>) => void,
        onReceiveRequestFullStateMessage?: (args: OnReceiveRequestFullStateMessageArgs<T>) => void
        ): void {
        // Initialize channel
        const eventName = this.getChannelName(channel);
        this.channelMap.set(eventName, channel.schema);
        this.stateMap.set(eventName, {});
        // Add handler
        this.setSocketHandler(eventName, (message: BaseMetaMessage, sender?: Socket) => {
            // Validate the message - in the sense that it is a valid message type, but doesn't guarantee that the state is valid
            const validMessage = baseMetaMessageSchema.safeParse(message).success;
            if (!validMessage) {
                console.warn("Invalid message received: ", message);
                return;
            }
            const messageType = this.getMessageType(message);

            // Handle request for full state
            if (messageType === "requestFullState") {
                if (this.hasValidState(channel)) {
                    this.sendFullState(channel);
                } else {
                    console.warn(`Invalid state for channel ${channel.name} - cannot send full state`);
                }
                onReceiveRequestFullStateMessage?.({
                    message: message as unknown as WithBaseMeta<BaseRequestFullStateMessage>,
                    alreadyHasFullState: this.hasValidState(channel),
                    sender
                });
                return;
            } 
            
            // Handle state update
            if (messageType === "state") {
                // See if we have the state initialized. It should, because we need to initalize it before we can receive updates.
                const currentState = this.stateMap.get(eventName);
                if (currentState === undefined) {
                    throw new Error("Channel not found. This should not happen.");
                }
                // Cast the message to the correct type
                const diffResult = message as unknown as DiffResult<T>;
                // Update the state
                mergeDiffInPlace((currentState as JSONObject), diffResult);
                // See if the new state is valid according to the state schema
                const valid = channel.schema.safeParse(currentState).success;
                // Update the state validity and value, and call the handler if it is valid and if there are any changes
                if (valid) {
                    this.statesValid.set(eventName, true);
                    // Call the handler if there are any changes
                    if (Object.keys(diffResult.modified).length > 0 || Object.keys(diffResult.deleted).length > 0) {
                        onStateChange?.(currentState as T);
                    }
                } else {
                    this.statesValid.set(eventName, false);
                }
                onReceiveStateMessage?.({
                    message: message as unknown as WithBaseMeta<BaseStateMessage>,
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
    _setState<T extends JSONObject>(channel: Channel<T>, state: T, allowDeletions: boolean = false) {
        const currentState = this.stateMap.get(channelPrefix+channel.name);
        if (currentState === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentState as T, state);
        // Disallow deletions of state properties
        if (!allowDeletions && Object.keys(diffResult.deleted).length > 0) {
            // @ts-ignore - somehow the types doesn't like we are setting RecursivePartial<RecursiveNull<T>> to {}. Works for now.
            diffResult.deleted = {};
        }
        // Only emit if there are changes
        if (Object.keys(diffResult.modified).length > 0 || Object.keys(diffResult.deleted).length > 0) {
            this.stateMap.set(channelPrefix+channel.name, state);
            this.sendDiffState(channel, diffResult);
        }
    }

    updateState<T extends JSONObject>(channel: Channel<T>, state: T) {
        this._setState(channel, state);
    }

    getState<T extends JSONObject>(channel: Channel<T>): T {
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