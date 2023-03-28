// Class extends SocketIO.Server but with extra methods to allow construction of topic sharing server

import { BaseClient, IBaseClientOptions, Unsubscriber } from "./BaseClient";

/**
 * Interface for a socket client that will be used by the TopicClient class
 */
export interface IClient {
    on(event: string, listener: (data: any) => void): void;
    emit(event: string, data: any): void;
    disconnect(): void;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * Client class that will be used to connect to a TopicServer
 */
export class TopicClient extends BaseClient {
    /**
     * The socket client instance
     */
    private socket: IClient;
    private connectionStatus: ConnectionStatus = "disconnected";
    private connectionStatusListeners: Set<(status: ConnectionStatus) => void> = new Set();
    /**
     * Creates a new TopicClient instance
     * @param socketClient The socket client instance
     */
    constructor(socketClient: IClient, options?: Partial<IBaseClientOptions>) {
        super(options);
        this.setConnectionStatus("connecting");
        this.socket = socketClient;
        this.initialize();
        this.socket.on("connect", () => {
            this.socket.emit("id", this._id); // Send the ID to the server, so it can match the SocketIO client ID with the TopicClient ID
            // Do nothing if error
            this.getServerID().then(id => {
                this.setConnectionStatus("connected");
            }).catch(() => {
                this.setConnectionStatus("connecting");
            });
        });
        this.socket.on("disconnect", () => {
            // When the socket disconnects, reset all topics
            this.setConnectionStatus("connecting");
            this.resetAllTopics();
        })
    }
    /**
     * Implementation of onRawEvent to allow the TopicClient to listen to events
     * @param event The socket event to listen to
     * @param listener The listener function
     */
    protected onRawEvent(event: string, listener: (data: any) => void): void {
        this.socket.on(event, listener);
    }
    /**
     * Implementation of emitRawEvent to allow the TopicClient to emit events
     * @param event The socket event to emit
     * @param data The data to send with the event
     */
    protected emitRawEvent(event: string, data: any): void {
        this.socket.emit(event, data);
    }
    /**
     * Subscribes to connection status changes
     * @param listener The listener function
     * @returns A function to unsubscribe from the connection status changes
     */
    subConnectionStatus(listener: (status: ConnectionStatus) => void): Unsubscriber {
        this.connectionStatusListeners.add(listener);
        listener(this.connectionStatus);
        return () => {
            this.unsubscribeConnectionStatus(listener);
        }
    }
    /**
     * Unsubscribes from connection status changes
     * @param listener The listener function
     */
    unsubscribeConnectionStatus(listener: (status: ConnectionStatus) => void): void {
        this.connectionStatusListeners.delete(listener);
    }
    /**
     * Sets the connection status
     * @param status The new connection status
     */
    protected setConnectionStatus(status: ConnectionStatus): void {
        this.connectionStatus = status;
        this.connectionStatusListeners.forEach(listener => listener(status));
    }
    disconnect(): void {
        this.socket.disconnect();
    }
}