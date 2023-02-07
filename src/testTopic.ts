import { z } from "zod";
import { Server } from "socket.io";
import { TopicServer } from "./Server";
import { TopicClient } from "./Client";
import { createTopic } from "./utils/createChannel";

const topicChannel = createTopic("test",
    z.object({
        a: z.string(),
        b: z.number()
    })
)

const socketIOServer = new Server(3001);
const topicServer = new TopicServer(socketIOServer);

topicServer.sub(topicChannel, (topic) => {
    console.log(`Server received topic: ${JSON.stringify(topic)}`)
});

// Client 1
const topicClient1 = new TopicClient("http://localhost:3001");
topicClient1.sub(topicChannel, (topic) => {
    console.log(`Client 1 received topic: ${JSON.stringify(topic)}`)
});

// Client 2
const topicClient2 = new TopicClient("http://localhost:3001");
topicClient2.sub(topicChannel, (topic) => {
    console.log(`Client 2 received topic: ${JSON.stringify(topic)}`)
});

// Client 3
const topicClient3 = new TopicClient("http://localhost:3001");
topicClient3.sub(topicChannel, (topic) => {
    console.log(`Client 3 received topic: ${JSON.stringify(topic)}`)
});

// Send updates regularly from client 1
setInterval(() => {
    topicClient1.pub(topicChannel, {
        a: "test",
        b: Math.random()
    });
}, 1000);