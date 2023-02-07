// Class extends SocketIO.Server but with extra methods to allow construction of state sharing server

import { Server, Socket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import { WithMeta, StateMessage, RequestFullStateMessage, CommandMessage, MessageMeta, CommandResponseMessage } from "./messages/Messages";
import { BaseStateClient, channelPrefix, DestType} from "./utils/BaseStateClient";
import { Channel, CommandChannel, StateChannel } from "./utils/Channel";
import { DiffResult } from "./utils/Compare";
import { JSONObject, JSONValue } from "./utils/JSON";

// Adapt for server types
// Make server mirror client messages so they get broadcasted to all clients

// TODO: Block spoofed messages
// TODO: Server responses are currently broadcasted. We should probably add destination IDs to emitRawEvent and only send to those clients

export class StateServer extends BaseStateClient<Socket> {
    private clientSockets: Map<string, Socket>;
    private channelHandlers: Map<string, (data: any, sender: Socket) => void>;
    private socket: Server;
    private socketToClientID: Map<string, string> = new Map();
    private clientToSocketID: Map<string, string> = new Map(); // Two way map for O(1) lookup on both sides
    static metaChannels = ["id"]; // Extra channels the server handles with onRawEvent
    constructor(server: Server, selfSubscribed: boolean = true) {
        super(selfSubscribed);
        this.socket = server;
        this.clientSockets = new Map(); // Map of client sockets
        this.channelHandlers = new Map(); // Map of socket event handlers (per channel)
        this.socket.on("connection", (socket) => {
            this.clientSockets.set(socket.id, socket);
            // Add handlers for all events listed in handlers
            socket.onAny((event: string, data: any) => {
                if (event.startsWith(channelPrefix) || StateServer.metaChannels.includes(event)) {
                    const handler = this.channelHandlers.get(event);
                    if (handler) {
                        handler(data, socket);
                    }
                }
            });
            socket.on("disconnect", () => {
                console.log("Client disconnected: " + socket.id);
                this.clientSockets.delete(socket.id);
                const clientID = this.socketToClientID.get(socket.id);
                if (clientID !== undefined) {
                    this.clientToSocketID.delete(clientID);
                    this.socketToClientID.delete(socket.id);
                }
            });
            // Send server ID to client
            socket.emit("id", this.id);
        });
        this.onRawEvent("id", (data: any, sender: Socket) => {
            // Check if client ID is already in use
            if (this.clientToSocketID.has(data)) {
                // Disconnect this client
                sender.disconnect();
                console.warn(`Client ${data} already connected, disconnecting`);
                return;
            }
            this.clientToSocketID.set(sender.id, data);
            this.socketToClientID.set(data, sender.id);
            console.log(`Client ${data} connected: ${sender.id}`)
        });
    }
    // General listener for event on all clients
    protected onRawEvent(event: string, listener: (data: any, sender: Socket) => void): void {
        this.channelHandlers.set(event, listener);
    }
    protected emitRawEvent(event: string, data: any): void {
        this.socket.emit(event, data);
    }
    protected relay<T extends JSONValue, U extends MessageMeta>(channel: Channel<T>, msg: U, senderSocket: Socket, dest: DestType = "*"): void {
        if (dest === "*") {
            // Broadcast to all sockets
            senderSocket.broadcast.emit(this.getChannelName(channel), msg);
        } else {
            // Find all sockets required
            let sockets: Socket[] = [];
            for (const clientID of dest) {
                const socketID = this.clientToSocketID.get(clientID);
                if (socketID) {
                    const socket = this.clientSockets.get(socketID);
                    if (socket) {
                        sockets.push(socket);
                    } else {
                        throw new Error(`Client ${clientID} has socket ID ${socketID} but socket not found`);
                    }
                } else if (clientID === this.id) {
                    // Ignore server
                } else {
                    console.warn(`Client ${clientID} not found`);
                }
            }
            // Send message to all sockets
            for (const socket of sockets) {
                socket.emit(this.getChannelName(channel), msg);
            }
        }
    }

    protected onReceiveStateMessage<T extends JSONValue>(channel: StateChannel<T>, msg: WithMeta<StateMessage>, sender: Socket): void {
        super.onReceiveStateMessage(channel, msg, sender);
        // TODO: Forwards state message to all clients except sender
        sender.broadcast.emit(this.getChannelName(channel), msg);
    }

    // Server should always know the full state, so this is not needed:
    // protected onReceiveRequestFullStateMessage<T extends JSONValue>(channel: StateChannel<T>, msg: WithMeta<RequestFullStateMessage>, sender: Socket): void {
    //     super.onReceiveRequestFullStateMessage(channel, msg, sender);
    //     // TODO: Forwards request full state message to all clients except sender (or actually, broadcasting would be fine and prompts other clients to sync up too!)
    //     // Alternatively: Broadcast to all clients to request full state, and only after all clients have responded, send complete state as one message
    // };

    protected onReceiveCommandMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, msg: WithMeta<CommandMessage>, sender: Socket): void {
        // TODO: Skip if server not a recipient
        if (msg.dest === "*" || msg.dest.includes(this.id)) {
            super.onReceiveCommandMessage(channel, msg, sender);
        }
        // TODO: Forwards command message to destination
        this.relay(channel, msg, sender, msg.dest);
    }

    protected onReceiveCommandResponseMessage<T extends JSONValue, U extends JSONValue>(channel: CommandChannel<T, U>, msg: WithMeta<CommandResponseMessage>, sender: Socket): void {
        // TODO: Skip if server not a recipient
        super.onReceiveCommandResponseMessage(channel, msg, sender);
        // TODO: Forwards command response to destination
        this.relay(channel, msg, sender, [msg.dest]);
    }
}