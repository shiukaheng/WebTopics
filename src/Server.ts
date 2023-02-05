// Class extends SocketIO.Server but with extra methods to allow construction of state sharing server

import { Server, Socket } from "socket.io";
import { BaseStateClient, channelPrefix} from "./utils/BaseStateClient";
import { Channel } from "./utils/Channel";
import { DiffResult } from "./utils/Compare";
import { JSONObject, JSONValue } from "./utils/JSON";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

export class StateServer extends BaseStateClient<Socket> {
    private clientSockets: Map<string, Socket>;
    private channelHandlers: Map<string, (data: any, sender: Socket) => void>;
    private socket: Server;
    constructor(server: Server, channels: Channel<any>[] = []) {
        super();
        this.socket = server;
        this.clientSockets = new Map(); // Map of client sockets
        this.channelHandlers = new Map(); // Map of socket event handlers (per channel)
        this.socket.on("connection", (socket) => {
            this.clientSockets.set(socket.id, socket);
            // Add handlers for all events listed in handlers
            socket.onAny((event: string, data: any) => {
                if (event.startsWith(channelPrefix)) {
                    const handler = this.channelHandlers.get(event);
                    if (handler) {
                        handler(data, socket);
                    }
                }
            });
            socket.on("disconnect", () => {
                console.log("Client disconnected: " + socket.id);
                this.clientSockets.delete(socket.id);
            });
        });
        // Add channels
        channels.forEach((channel) => {
            this.addStateChannel(channel);
        });
    }
    // General listener for event on all clients
    protected onEvent(event: string, listener: (data: any, sender: Socket) => void): void {
        this.channelHandlers.set(event, listener);
    }
    protected emitEvent(event: string, data: any): void {
        this.socket.emit(event, data);
    }
    sendDiffState<T extends JSONValue>(channel: Channel<T>, diffResult: DiffResult<T, T>): void {
        this.sendStateMessage(channel, diffResult as JSONObject);
    }
    private relayStateMessage<T extends JSONValue>(channel: Channel<T>, diffResult: DiffResult<T, T>, sender: Socket): void {
        sender.broadcast.emit(this.getChannelName(channel), this.wrapMessage(diffResult as JSONObject, "state"));
    }
    addStateChannel<T extends JSONValue>(channel: Channel<T>, handler?: ((state: T) => void) | undefined): void {
        super.addStateChannel(channel, 
            // Handle state changes
            handler, 
            // Handle on receive state message
            (event) => {
                // Forwards state message to all clients except sender
                if (event.sender) {
                    this.relayStateMessage(channel, event.diffResult, event.sender);
                } else {
                    throw new Error("No sender for state message?");
                }
            },
            // Handle on receive request full state message
            (event) => {
                // Already dealt with in BaseStateClient to send full state when requested
            }
        );
    }
}