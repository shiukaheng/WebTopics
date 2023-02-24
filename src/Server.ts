// Class extends SocketIO.Server but with extra methods to allow construction of topic sharing server

import { WithMeta, TopicMessage, ServiceMessage, MessageMeta, ServiceResponseMessage } from "./messages/Messages";
import { ServerMeta, serverMetaChannel } from "./metaChannels";
import { BaseClient, channelPrefix, DestType } from "./BaseClient";
import { Channel, ServiceChannel, TopicChannel } from "./utils/Channel";
import { JSONValue } from "./utils/JSON";

export interface IServerClient {
    disconnect(): void;
    id: string;
    emit: (event: string, data: any) => void;
    broadcast: {
        emit: (event: string, data: any) => void;
    }
    onAny: (listener: (event: string, data: any) => void) => void;
    on: (event: string, listener: (data: any) => void) => void;
}

export interface IServer {
    on: (event: string, listener: (socket: IServerClient) => void) => void;
    emit: (event: string, data: any) => void;
}

// TODO: Block spoofed messages
// TODO: Server responses are currently broadcasted. We should probably add destination IDs to emitRawEvent and only send to those clients

export class TopicServer extends BaseClient<IServerClient> {
    private clientSockets: Map<string, IServerClient>;
    private channelHandlers: Map<string, (data: any, sender?: IServerClient) => void>;
    private socket: IServer;
    private socketToClientID: Map<string, string> = new Map();
    private clientToSocketID: Map<string, string> = new Map(); // Two way map for O(1) lookup on both sides
    private clientMeta: ServerMeta = {
        serverID: this._id,
        clients: { // Server will fill in itself too, so no need to add it here
        }
    };
    static metaChannels = ["id"]; // Extra channels the server handles with onRawEvent
    constructor(server: IServer) {
        super();
        this.socket = server;
        this.clientSockets = new Map(); // Map of client sockets
        this.channelHandlers = new Map(); // Map of socket event handlers (per channel)
        this.initialize();
        this.socket.on("connection", (socket) => {
            this.clientSockets.set(socket.id, socket);
            // Add handlers for all events listed in handlers
            socket.onAny((event: string, data: any) => {
                if (event.startsWith(channelPrefix) || TopicServer.metaChannels.includes(event)) {
                    const handler = this.channelHandlers.get(event);
                    if (handler) {
                        handler(data, socket);
                    }
                }
            });
            socket.on("disconnect", () => {
                console.log("❌ Client disconnected: " + socket.id);
                this.clientSockets.delete(socket.id);
                const clientID = this.socketToClientID.get(socket.id);
                if (clientID !== undefined) {
                    this.clientToSocketID.delete(clientID);
                    this.socketToClientID.delete(socket.id);
                    // Remove client from server meta
                    delete this.clientMeta.clients[clientID as string];
                    super.pub(serverMetaChannel, this.clientMeta);
                } else {
                    console.warn("Client disconnected, but no matching client ID found");
                }
            });
            // Send server ID to client
            socket.emit("id", this._id);
            // Add client to server meta
        });
        this.onRawEvent("id", (data: any, sender?: IServerClient) => {
            if (sender !== undefined) {
                // Check if client ID is already in use
                if (this.clientToSocketID.has(data)) {
                    // Disconnect this client
                    sender.disconnect();
                    console.warn(`Client ${data} already connected, disconnecting`);
                    return;
                }
                this.clientToSocketID.set(data, sender.id);
                this.socketToClientID.set(sender.id, data);
                console.log(`✅ Client ${data} connected to server`);
            } else {
                throw new Error("No sender provided, should not happen for id event"); // No senders happen when server sends message to itself
            }
        });
    }
    protected initialize(): void {
        this.sub(serverMetaChannel, (data: ServerMeta) => {
            this.clientMeta = data;
        });
        super.pub(serverMetaChannel, this.clientMeta, true, false);
        super.initialize(); // Initialize afterwards, so we publish server ID first, so the subscription doesnt overwrite client meta (and its server ID)
    }
    // General listener for event on all clients
    protected onRawEvent(event: string, listener: (data: any, sender?: IServerClient) => void): void {
        this.channelHandlers.set(event, listener);
    }
    protected emitRawEvent(event: string, data: any, dest: DestType): void {
        if (dest === "*") {
            // Broadcast to all sockets
            this.socket.emit(event, data);
        } else {
            // See if we can find our own id, directly send to ourselves. 
            // This use case is for calling our services without going through the server. Topics are always broadcasted so it won't be an issue.
            if (dest.includes(this.id)) {
                const handler = this.channelHandlers.get(event);
                if (handler) {
                    handler(data);
                }
            }
            // Find all sockets required
            let sockets: IServerClient[] = this.getSockets(dest);
            // Send message to all sockets
            for (const socket of sockets) {
                socket.emit(event, data);
            }
        }
    }
    private getSockets(dest: string[]) {
        let sockets: IServerClient[] = [];
        for (const clientID of dest) {
            const socketID = this.clientToSocketID.get(clientID);
            if (socketID) {
                const socket = this.clientSockets.get(socketID);
                if (socket) {
                    sockets.push(socket);
                } else {
                    throw new Error(`Client ${clientID} has socket ID ${socketID} but socket not found`);
                }
            } else if (clientID === this._id) {
                // Ignore server
            } else {
                console.warn(`Client ${clientID} not found`);
            }
        }
        return sockets;
    }

    protected relay<T extends JSONValue, U extends MessageMeta>(channel: Channel<T>, msg: U, senderSocket: IServerClient, dest: DestType = "*"): void {
        if (dest === "*") {
            // Broadcast to all sockets
            senderSocket.broadcast.emit(this.getChannelName(channel), msg);
        } else {
            // Find all sockets required
            let sockets: IServerClient[] = [];
            for (const clientID of dest) {
                const socketID = this.clientToSocketID.get(clientID);
                if (socketID) {
                    const socket = this.clientSockets.get(socketID);
                    if (socket) {
                        sockets.push(socket);
                    } else {
                        throw new Error(`Client ${clientID} has socket ID ${socketID} but socket not found`);
                    }
                } else if (clientID === this._id) {
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

    protected onReceiveTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<TopicMessage>, sender?: IServerClient): void {
        super.onReceiveTopicMessage(channel, msg, sender);
        // TODO: Forwards topic message to all clients except sender
        if (sender !== undefined) { // When sender is undefined, it is the server itself
            sender.broadcast.emit(this.getChannelName(channel), msg);
        }
    }

    // Server should always know the full topic, so this is not needed:
    // protected onReceiveRequestFullTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<RequestFullTopicMessage>, sender: Socket): void {
    //     super.onReceiveRequestFullTopicMessage(channel, msg, sender);
    //     // TODO: Forwards request full topic message to all clients except sender (or actually, broadcasting would be fine and prompts other clients to sync up too!)
    //     // Alternatively: Broadcast to all clients to request full topic, and only after all clients have responded, send complete topic as one message
    // };

    protected onReceiveServiceMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceMessage>, sender?: IServerClient): void {
        // Skip if server not a recipient
        if (msg.dest === "*" || msg.dest.includes(this.id)) {
            super.onReceiveServiceMessage(channel, msg, sender);
        }
        // Forward service message to destination
        if (sender !== undefined) {
            this.relay(channel, msg, sender, msg.dest);
        }
    }

    protected onReceiveServiceResponseMessage<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceResponseMessage>, sender?: IServerClient): void {
        // Skip if server not a recipient
        if (msg.dest === this.id) {
            super.onReceiveServiceResponseMessage(channel, msg, sender);
        }
        // Forwards service response to destination
        if (sender !== undefined) {
            this.relay(channel, msg, sender, [msg.dest]);
        }
    }

    initChannels(channels: Array<TopicChannel<any> | ServiceChannel<any, any>>): void {
        channels.forEach((channel) => {
            // If channel is a topic channel, run initTopicChannel
            if (channel.mode === "topic") {
                this.initTopicChannel(channel);
            }
            // If channel is a service channel, run initServiceChannel
            if (channel.mode === "service") {
                this.initServiceChannel(channel);
            }
        });
    }
}