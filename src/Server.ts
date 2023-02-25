// Class extends SocketIO.Server but with extra methods to allow construction of topic sharing server

import { WithMeta, TopicMessage, ServiceMessage, MessageMeta, ServiceResponseMessage, RequestFullTopicMessage } from "./messages/Messages";
import { ServerMeta, serverMetaChannel } from "./metaChannels";
import { BaseClient, channelPrefix, DestType } from "./BaseClient";
import { Channel, RequestType, ServiceChannel, ServiceResponseType, TopicChannel } from "./utils/Channel";
import { JSONValue } from "./utils/JSON";
import { TopicClient } from "./Client";
import { DiffResult } from "./utils/Compare";

/**
 * Server client interface; this is the interface that the server uses to directly communicate with the client
 */
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

/**
 * Server interface for listening and emitting events
 */
export interface IServer {
    on: (event: string, listener: (socket: IServerClient) => void) => void;
    emit: (event: string, data: any) => void;
}

export interface IServerOptions {
    /**
     * Whether to log all topic messages
     * @default false
     */
    logTopics: boolean;
    /**
     * Whether to log all service messages
     * @default false
     */
    logServices: boolean;
}

// TODO: Block spoofed messages
// TODO: Server responses are currently broadcasted. We should probably add destination IDs to emitRawEvent and only send to those clients

/**
 * Server class to host topic and service channels for {@link TopicClient} instances to connect to
 */
export class TopicServer extends BaseClient<IServerClient> {
    /**
     * Map between socket IDs and {@link IServerClient} instances
     */
    private clientSockets: Map<string, IServerClient>;
    /**
     * Raw handlers for socket events
     */
    private channelHandlers: Map<string, (data: any, sender?: IServerClient) => void>;
    /**
     * The socket server instance
     */
    private socket: IServer;
    /**
     * Map between socket IDs and {@link TopicClient} IDs
     */
    private socketToClientID: Map<string, string> = new Map();
    /**
     * Map between {@link TopicClient} IDs and socket IDs
     */
    private clientToSocketID: Map<string, string> = new Map(); // Two way map for O(1) lookup on both sides
    /**
     * Internal server meta data for storing clients connected, and the services they provide
     */
    private clientMeta: ServerMeta = {
        serverID: this._id,
        clients: { // Server will fill in itself too, so no need to add it here
        }
    };
    /**
     * Server options
     */
    private options: IServerOptions = {
        logTopics: false,
        logServices: false
    };
    /**
     * Extra channels the server handles with onRawEvent that are not topic or service channels
     */
    static metaChannels = ["id"]; // "id" channel is used to match socket IDs with client IDs. Clients will send their ID to the server on connect, and the server will match it with the socket ID.

    /**
     * Creates a new TopicServer instance
     * @param server The socket server instance
     */
    constructor(server: IServer, options?: Partial<IServerOptions>) {
        super();
        this.socket = server;
        this.options = {
            ...this.options,
            ...options
        }
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
    /**
     * Initialize the server by linking {@link TopicServer.clientMeta} to the server meta channel, and calling {@link BaseClient.initialize}
     */
    protected initialize(): void {
        this.sub(serverMetaChannel, (data: ServerMeta) => {
            this.clientMeta = data;
        });
        super.pub(serverMetaChannel, this.clientMeta, true, false);
        super.initialize(); // Initialize afterwards, so we publish server ID first, so the subscription doesnt overwrite client meta (and its server ID)
    }
    // General listener for event on all clients
    /**
     * Add a listener for a raw event on all clients
     * @param event The event name
     * @param listener The listener function
     */
    protected onRawEvent(event: string, listener: (data: any, sender?: IServerClient) => void): void {
        this.channelHandlers.set(event, listener);
    }
    /**
     * Emit a raw event to all clients
     * @param event The event name 
     * @param data The data to send
     * @param dest The destination clients. "*" for all clients, or an array of client IDs
     */
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
    /**
     * Get all {@link IServerClient} sockets from a list of {@link TopicClient} IDs
     * @param dest The list of client IDs
     * @returns An array of {@link IServerClient} sockets
     */
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

    /**
     * Relays a message to destination clients
     * @param channel The channel to relay the message on
     * @param msg The message to relay
     * @param senderSocket The socket of the sender
     * @param dest The destination clients
     */
    protected relay<T extends RequestType, U extends MessageMeta>(channel: Channel<T>, msg: U, senderSocket: IServerClient, dest: DestType = "*"): void {
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

    /**
     * Handle a message received from a client
     * @param channel The channel the message was received on
     * @param msg The message received
     * @param sender The socket of the sender
     */
    protected onReceiveTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<TopicMessage>, sender?: IServerClient): void {
        super.onReceiveTopicMessage(channel, msg, sender);
        // TODO: Forwards topic message to all clients except sender
        if (sender !== undefined) { // When sender is undefined, it is the server itself
            sender.broadcast.emit(this.getChannelName(channel), msg);
            if (this.options.logTopics) {
                console.log(`📡 Received topic message on ${channel} from ${msg.source} and forwarded to all clients except sender`);
            }
        } else {
            if (this.options.logTopics) {
                console.log(`📬 Received topic from self on ${channel}`);
            }
        }
    }

    protected onReceiveRequestFullTopicMessage<T extends JSONValue>(channel: TopicChannel<T>, msg: WithMeta<{}>, sender?: IServerClient | undefined): void {
        if (this.options.logTopics) {
            if (sender !== undefined) {
                console.log(`📡 Received request full topic message on ${channel} from ${msg.source} and forwarded to all clients`);
            } else {
                console.log(`📬 Received request full topic from self on ${channel}`);
            }
        }
        super.onReceiveRequestFullTopicMessage(channel, msg, sender);
    }

    protected sendDiffTopic<T extends JSONValue>(channel: TopicChannel<T>, diff: DiffResult<T, T>, source?: string): void {
        if (this.options.logTopics) {
            if (source !== this.id) {
                console.log(`⏩ Topic diff forwarded to all clients from ${source}: ${JSON.stringify(diff)}`);
            } else {
                console.log(`📢 Topic diff sent from server to all clients: ${JSON.stringify(diff)}`);
            }
        }
        super.sendDiffTopic(channel, diff, source);
    }

    protected sendFullTopic<T extends JSONValue>(channel: TopicChannel<T>, source?: string): void {
        if (this.options.logTopics) {
            if (source !== this.id) {
                console.log(`⏩ Topic full data forwarded to all clients from ${source}: ${JSON.stringify(this.getTopicSync(channel))}`);
            } else {
                console.log(`📢 Topic full data sent from server to all clients: ${JSON.stringify(this.getTopicSync(channel))}`);
            }
        }
        super.sendFullTopic(channel, source);
    }
    
    /**
     * Handle a service message received from a client, only handling if server is a recipient, otherwise forwarding to destination
     * @param channel The channel the message was received on
     * @param msg The message received
     * @param sender The socket of the sender
     */
    protected onReceiveServiceMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceMessage>, sender?: IServerClient): void {
        // Skip if server not a recipient
        if (msg.dest === "*" || msg.dest.includes(this.id)) {
            super.onReceiveServiceMessage(channel, msg, sender);
        }
        // Forward service message to destination
        if (sender !== undefined) {
            this.relay(channel, msg, sender, msg.dest);
        }
    }

    /**
     * Handle a service response message received from a client, only handling if server is a recipient, otherwise forwarding to destination
     * @param channel The channel the message was received on
     * @param msg The message received
     * @param sender The socket of the sender
     */
    protected onReceiveServiceResponseMessage<T extends RequestType=void, U extends ServiceResponseType=void>(channel: ServiceChannel<T, U>, msg: WithMeta<ServiceResponseMessage>, sender?: IServerClient): void {
        // Skip if server not a recipient
        if (msg.dest === this.id) {
            super.onReceiveServiceResponseMessage(channel, msg, sender);
        }
        // Forwards service response to destination
        if (sender !== undefined) {
            this.relay(channel, msg, sender, [msg.dest]);
        }
    }

    /**
     * Convenience method to initialize an array of channels so the server will handle them
     * @param channels The array of channels to initialize
     */
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