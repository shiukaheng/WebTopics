import { z } from "zod";
import { Server } from "socket.io";
import { TopicServer } from "./Server";
import { TopicClient } from "./Client";
import { createTopic } from "./utils/createChannel";
import { serverMetaChannel } from "./metaChannels";

// Create a server
const server = new TopicServer(new Server(3002));

server.sub(serverMetaChannel, (data)=>{
    console.log("🎊 Server meta:", data);
})

// Make the 3 clients connect 1 by 1 with a 1 second delay
setTimeout(()=>{
    const client1 = new TopicClient("http://localhost:3002");
}
, 1000);
setTimeout(()=>{
    const client2 = new TopicClient("http://localhost:3002");
}
, 2000);