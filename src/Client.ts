// Class extends SocketIO.Server but with extra methods to allow construction of state sharing server

import { io, Socket } from "socket.io-client";
import { BaseStateClient} from "./utils/BaseStateClient";
import { Channel, StateChannel } from "./utils/Channel";
import { DiffResult } from "./utils/Compare";
import { JSONObject, JSONValue } from "./utils/JSON";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

export class StateClient extends BaseStateClient {
    private socket: Socket;
    public serverID: string | undefined;
    constructor(serverURL: string, selfSubscribed: boolean = true) {
        super(selfSubscribed);
        this.socket = io(serverURL);
        this.socket.on("connect", () => {
            this.socket.emit("id", this.id);
        });
        this.socket.on("id", (data: any) => {
            this.serverID = data as string;
        });
    }
    protected onRawEvent(event: string, listener: (data: any) => void): void {
        this.socket.on(event, listener);
    }
    protected emitRawEvent(event: string, data: any): void {
        this.socket.emit(event, data);
    }
    // sub<T extends JSONValue>(channel: StateChannel<T>, handler?: ((state: T) => void) | undefined): void {
    //     super.sub(channel, 
    //         // Handle state changes
    //         handler
    //     );
    // }
}