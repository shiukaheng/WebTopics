import { io, Socket } from "socket.io-client";
// import { z } from "zod";
// import { diff, DiffResult, mergeDiff, mergeDiffInPlace, State } from "./Compare";

const channelPrefix = "ch-";

export class TestStateClient {
    protected socket: Socket;
	constructor(serverUrl: string) {
        this.socket = io(serverUrl, {forceNew: true});
        this.socket.on("update", (message) => {
            console.log("Received update message:", message);
        });
        this.socket.on("connect", () => {
            console.log("Connected to server");
        });
    }
    update() {
        console.log("Sending update message");
        this.socket.emit("update", {timestamp: Date.now(), sender: this.socket.id});
    }
}