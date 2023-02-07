// Class extends SocketIO.Server but with extra methods to allow construction of state sharing server

import { io, Socket } from "socket.io-client";
import { BaseStateClient} from "./utils/BaseStateClient";
import { Channel } from "./utils/Channel";
import { DiffResult } from "./utils/Compare";
import { JSONObject, JSONValue } from "./utils/JSON";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

export class StateClient extends BaseStateClient {
    private socket: Socket;
    constructor(serverURL: string, selfSubscribed: boolean = true) {
        super(selfSubscribed);
        this.socket = io(serverURL);
        this.socket.on("connect", () => {
            this.socket.emit("id", this.id);
        });
    }
    protected onRawEvent(event: string, listener: (data: any) => void): void {
        this.socket.on(event, listener);
    }
    protected emitRawEvent(event: string, data: any): void {
        this.socket.emit(event, data);
    }
    sub<T extends JSONValue>(channel: Channel<T>, handler?: ((state: T) => void) | undefined): void {
        super.sub(channel, 
            // Handle state changes
            handler
        );
    }
}