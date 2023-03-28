import { TopicServer } from "./Server";
import { TopicClient } from "./Client";
import { Server } from "socket.io";
import { io } from "socket.io-client";
import { serverMetaChannel } from "./metaChannels";

// Create a new TopicServer instance
const ioServer = new Server(5100);
const server = new TopicServer(ioServer);

// Create a new TopicClient instance and disconnect in 1 second
const socket = io("http://localhost:5100");
const client = new TopicClient(socket);

setTimeout(() => {
    client.disconnect();
    }, 2000);

server.sub(serverMetaChannel, (data) => {
    // console.log("Server received data:");
    // console.log(data);
    console.log("📡 Got:", data);
});