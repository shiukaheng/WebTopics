// Class extends SocketIO.Server but with extra methods to allow construction of topic sharing server

import { io, Socket } from "socket.io-client";
import { BaseClient} from "./BaseClient";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

export class TopicClient extends BaseClient {
    private socket: Socket;
    public serverID: string | undefined;
    constructor(socketClient: Socket) {
        super();
        this.socket = socketClient;
        this.initialize();
        this.socket.on("connect", () => {
            this.socket.emit("id", this._id);
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
}