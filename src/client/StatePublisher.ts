import { io, Socket } from "socket.io-client";
import { z } from "zod";
import { createFullStateUpdate, StateClient } from "./BaseStateClient";
import { State, diff } from "./Compare";

/**
 * State publisher class, allows efficient publishing of state of specified schema to a server
 */
class StatePublisher<T extends State> extends StateClient<T> {

	constructor(serverUrl: string, channel: string, schema: z.ZodSchema<T>) {
		super(serverUrl, channel, schema);
		// Add a listener to the socket to emit the full state when a client connects
		this.socket.on('connect', () => {
			this.emitFullCurrentState();
		});
	}

	publish(state: T) {
		if (this.state === undefined) {
			this.state = state;
			this.socket.emit(this.channel, createFullStateUpdate(state));
			return;
		} else {
			const diffResult = diff(this.state, state);
			if (Object.keys(diffResult.modified).length > 0 || Object.keys(diffResult.deleted).length > 0) {
				this.socket.emit(this.channel, diffResult);
			}
		}
	}

	emitFullCurrentState() {
		if (this.state !== undefined) {
			this.socket.emit(this.channel, createFullStateUpdate(this.state));
		}
	}

	stop() {
		this.socket.disconnect();
	}
}