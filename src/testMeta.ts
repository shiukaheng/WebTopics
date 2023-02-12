import { z } from "zod";
import { Server } from "socket.io";
import { TopicServer } from "./Server";
import { TopicClient } from "./Client";
import { createTopic } from "./utils/createChannel";
import { serverMetaChannel } from "./metaChannels";
import { io } from "socket.io-client";

// Create a server
const server = new TopicServer(new Server(3002));

server.sub(serverMetaChannel, (data)=>{
    console.log("🎊 Server meta:", data);
})

// Make the 3 clients connect 1 by 1 with a 1 second delay
setTimeout(()=>{
    const client1 = new TopicClient(io("http://localhost:3002"));
    client1.sub(serverMetaChannel, (data)=>{
        console.log("🎊 Client 1 server meta:", data);
    })
}
, 5000);
setTimeout(()=>{
    const client2 = new TopicClient(io("http://localhost:3002"));
    client2.sub(serverMetaChannel, (data)=>{
        console.log("🎊 Client 2 server meta:", data);
    })
}
, 10000);