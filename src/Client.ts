// Class extends SocketIO.Server but with extra methods to allow construction of state sharing server

import { io } from "socket.io-client";
import { BaseStateClient} from "./utils/BaseStateClient";
import { Channel } from "./utils/Channel";
import { DiffResult } from "./utils/Compare";
import { JSONObject, JSONValue } from "./utils/JSON";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

export class StateClient extends BaseStateClient {
    protected setSocketHandler(event: string, listener: (data: any) => void): void {
        this.socket.on(event, listener);
    }
    constructor(serverURL: string) {
        super();
        this.socket = io(serverURL);
    }
    protected socket: { emit: (event: string, ...args: any[]) => void; on: (event: string, listener: (...args: any[]) => void) => void; };
    sendDiffState<T extends JSONValue>(channel: Channel<T>, diffResult: DiffResult<T, T>): void {
        this.sendStateMessage(channel, diffResult as JSONObject);
    }
    addStateChannel<T extends JSONValue>(channel: Channel<T>, handler?: ((state: T) => void) | undefined): void {
        super.addStateChannel(channel, 
            // Handle state changes
            handler
        );
    }
}