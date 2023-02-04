import { io, Socket } from "socket.io-client";
import { z } from "zod";
import { DiffResult, State } from "./Compare";

export type StateUpdate<T extends State> = DiffResult<T> | {
	fullState: T;
}

export function createFullStateUpdate<T extends State>(fullState: T): StateUpdate<T> {
	return {
		fullState,
	}
}

export class StateClient<T extends State> {
    protected socket: Socket;
    protected channel: string;
    protected schema: z.ZodSchema<T>;
    protected state: T | undefined;
	constructor(serverUrl: string, channel: string, schema: z.ZodSchema<T>) {
		this.socket = io(serverUrl);
		this.state = undefined;
		this.channel = channel;
		this.schema = schema;
	}
    stop() {
        this.socket.disconnect();
    }
}