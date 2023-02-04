import { io, Socket } from "socket.io-client";
import { z } from "zod";
import { diff, DiffResult, mergeDiff, mergeDiffInPlace, State } from "./Compare";

const metaMessageSchema = z.object({
    timestamp: z.number(),
    sender: z.string()
});
type MetaMessage = z.infer<typeof metaMessageSchema>;

const requestFullStateMessageSchema = z.object({
    requestFullState: z.literal(true),
    ...metaMessageSchema.shape
});
type RequestFullStateMessage = z.infer<typeof requestFullStateMessageSchema>;

const diffStateMessageSchema = z.object({
    ...metaMessageSchema.shape,
    modified: z.record(z.unknown()),
    deleted: z.record(z.unknown())
});
type DiffStateMessage = z.infer<typeof diffStateMessageSchema>;

const messageTypesSchema = z.union([requestFullStateMessageSchema, diffStateMessageSchema]);
type MessageTypes<T extends State> = z.infer<typeof messageTypesSchema>;



export type StateMessage<T extends State> = MessageTypes<T> & MetaMessage;

// const a: StateMessage<State> = {
//     timestamp: 0,
//     sender: "test",
//     requestFullState: true
// }

export type Channel<T extends State> = {
    name: string;
    schema: z.ZodSchema<T>;
}

const channelPrefix = "ch:";

export class StateClient {
    protected socket: Socket;
    protected channelMap: Map<string, z.ZodSchema<State>> = new Map();
    protected stateMap: Map<string, State> = new Map(); // Not guaranteed to be complete, need validation on each update
    protected statesValid: Map<string, boolean> = new Map();
    // Disallow deletions of state properties (recursively)
	constructor(serverUrl: string) {
        this.socket = io(serverUrl);
	}
    private sendStateMessage<T extends State>(channel: Channel<T>, message: StateMessage<T>) {
        this.socket.emit(channelPrefix+channel.name, message);
    }
    private sendRequestFullStateMessage<T extends State>(channel: Channel<T>) {
        this.sendStateMessage(channel, {requestFullState: true, timestamp: Date.now(), sender: this.socket.id});
    }
    private sendDiffStateMessage<T extends State>(channel: Channel<T>, diffResult: DiffResult<T>) {
        this.sendStateMessage(channel, {...diffResult, timestamp: Date.now(), sender: this.socket.id});
    }
    private sendFullState<T extends State>(channel: Channel<T>, state: T) {
        // @ts-ignore TODO: Fix this. Functional but not type safe!
        this.sendStateMessage(channel, {modified: state, deleted: {}, timestamp: Date.now(), sender: this.socket.id});
    }
    addState<T extends State>(channel: Channel<T>, handler?: (state: T) => void): StateClient {
        const eventName = channelPrefix+channel.name;
        this.channelMap.set(eventName, channel.schema);
        this.stateMap.set(eventName, {});
        this.socket.on(eventName, (message: StateMessage<T>) => {
            // Ignore messages from self
            if (message.sender === this.socket.id) {
                return;
            }

            // Validate the message - in the sense that it is a valid message type
            const validMessage = messageTypesSchema.safeParse(message).success;
            if (!validMessage) {
                throw new Error("Invalid message received");
            }

            // Handle full state request
            // @ts-ignore - its an optional property
            if (message.requestFullState && this.statesValid.get(eventName)) {
                this.sendFullState(channel, this.stateMap.get(eventName) as T);
                return;
            }

            // Handle diff update. Since we only have two types of messages, we can assume that it is a diff update
            const currentState = this.stateMap.get(eventName);
            const diffResult = message as unknown as DiffResult<T>;
            mergeDiffInPlace((currentState as State), diffResult);
            const valid = channel.schema.safeParse(currentState).success;
            // Update the state validity and value, and call the handler if there are any changes
            if (valid) {
                this.statesValid.set(eventName, true);
                // Call the handler if there are any changes
                if (Object.keys(diffResult.modified).length > 0 || Object.keys(diffResult.deleted).length > 0) {
                    handler?.(currentState as T);
                }
            } else {
                this.statesValid.set(eventName, false);
            }
        });
        return this;
    }
    updateState<T extends State>(channel: Channel<T>, state: T) {
        const currentState = this.stateMap.get(channelPrefix+channel.name);
        if (currentState === undefined) {
            throw new Error("Channel not found");
        }
        const diffResult = diff(currentState as T, state);
        // Disallow deletions of state properties
        if (Object.keys(diffResult.deleted).length > 0) {
            throw new Error("Deletion of state properties not allowed, please use nullable properties instead");
        }
        // Only emit if there are changes
        if (Object.keys(diffResult.modified).length > 0) {
            this.sendStateMessage(channel, {...diffResult, timestamp: Date.now(), sender: "client"});
        }
    }
}