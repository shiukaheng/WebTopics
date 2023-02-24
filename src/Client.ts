// Class extends SocketIO.Server but with extra methods to allow construction of topic sharing server

import { BaseClient } from "./BaseClient";

/**
 * Interface for a socket client that will be used by the TopicClient class
 */
export interface IClient {
    on(event: string, listener: (data: any) => void): void;
    emit(event: string, data: any): void;
}

/**
 * Client class that will be used to connect to a TopicServer
 */
export class TopicClient extends BaseClient {
    /**
     * The socket client instance
     */
    private socket: IClient;
    /**
     * Creates a new TopicClient instance
     * @param socketClient The socket client instance
     */
    constructor(socketClient: IClient) {
        super();
        this.socket = socketClient;
        this.initialize();
        this.socket.on("connect", () => {
            this.socket.emit("id", this._id); // Send the ID to the server, so it can match the SocketIO client ID with the TopicClient ID
        });
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
}