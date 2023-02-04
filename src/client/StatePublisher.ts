import { io, Socket } from "socket.io-client";
import { z } from "zod";
import { State } from "./Compare";

/**
 * State publisher class, allows efficient publishing of state of specified schema to a server
 */
class StatePublisher<T extends State> {
	private socket: Socket;
	private lastState: undefined | T;

	constructor(serverUrl: string, channel: string, schema: z.ZodSchema<T>) {
		this.socket = io(serverUrl);
		this.lastState = undefined;
	}

	publish(state: T) {
		this.socket.emit("state", state);
	}
}

const testStateSchema = z.object({
	test: z.string(),
});

// type TestState = z.infer<typeof testStateSchema>;

// const testPublisher = new StatePublisher("http://localhost:3000", "test", testStateSchema);
// testPublisher.publish({ test: "test" });