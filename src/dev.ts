import { TopicServer } from "./Server";
import { TopicClient } from "./Client";
import { Server } from "socket.io";
import { io } from "socket.io-client";

// Create a new TopicServer instance
const ioServer = new Server(5100);
const server = new TopicServer(ioServer);

// Create a new TopicClient instance
const socket = io("http://localhost:5100");
const client = new TopicClient(socket);

// Quickly call the client 10 times, 100ms apart, for client.getServerID() (it returns promise)
for (let i = 0; i < 10; i++) {
    setTimeout(() => {
    client.getServerID(100).then((id) => {
        // console.log(id);
    }).catch((err) => {
        console.log(`Error on ${i}`)
    })
    }, i * 3);
}