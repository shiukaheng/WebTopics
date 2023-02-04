import { io, Socket } from "socket.io-client";
import { z } from "zod";
import { createFullStateUpdate, StateClient, StateUpdate } from "./BaseStateClient";
import { State, diff } from "./Compare";

// /**
//  * State publisher class, allows efficient publishing of state of specified schema to a server
//  */
// class StateAggregator<T extends State> extends StateClient<T> {

// 	constructor(serverUrl: string, channel: string, schema: z.ZodSchema<T>) {
// 		super(serverUrl, channel, schema);
//         // Add a listener to the socket to listen for state updates, but ignore messages sent from this client
//         this.socket.on(this.channel, (stateUpdate: StateUpdate<T>) => {

// 	}

// 	stop() {
// 		this.socket.disconnect();
// 	}
// }