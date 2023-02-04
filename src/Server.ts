// Class extends SocketIO.Server but with extra methods to allow construction of state sharing server

import { Server } from "socket.io";
import { Socket } from "socket.io-client";
import { BaseStateClient} from "./utils/BaseStateClient";
import { Channel } from "./utils/Channel";
import { DiffResult } from "./utils/Compare";
import { JSONObject } from "./utils/State";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

export class StateServer extends BaseStateClient {
    private clientSockets: Map<string, Socket>;
    private handlers: Map<string, (data: any) => void>;
    constructor(server: Server) {
        super();
        this.socket = server;
        this.clientSockets = new Map();
        this.handlers = new Map();
        this.socket.on("connection", (socket) => {
            console.log("Client connected: " + socket.id);
            this.clientSockets.set(socket.id, socket);
            // Add handlers for all events listed in handlers
            this.handlers.forEach((listener, event) => {
                socket.on(event, listener);
            });
            socket.on("disconnect", () => {
                console.log("Client disconnected: " + socket.id);
                this.clientSockets.delete(socket.id);
            });
        });
    }
    // General listener for event on all clients
    protected socketOn(event: string, listener: (data: any) => void): void {
        this.handlers.set(event, listener);
        // Add handler to all existing clients if they don't already have it
        this.clientSockets.forEach((socket) => {
            socket.off(event, listener);
            socket.on(event, listener);
        });
    }
    protected socket: { emit: (event: string, ...args: any[]) => void; on: (event: string, listener: (...args: any[]) => void) => void; };
    sendRequestFullState<T extends JSONObject>(channel: Channel<T>): void {
        this.sendRawStateMessage(channel, {
            requestFullState: true
        });
    }
    sendDiffState<T extends JSONObject>(channel: Channel<T>, diffResult: DiffResult<T>): void {
        this.sendRawStateMessage(channel, diffResult as JSONObject);
    }
    addStateChannel<T extends JSONObject>(channel: Channel<T>, handler?: ((state: T) => void) | undefined): void {
        super.addStateChannel(channel, 
            // Handle state changes
            handler, 
            // Handle on receive state message
            (event) => {
                // Forwards state message to all clients
                this.sendDiffState(channel, event.diffResult);
            },
            // Handle on receive request full state message
            (event) => {
                // Already dealt with in BaseStateClient to send full state when requested
            }
        );
    }
}