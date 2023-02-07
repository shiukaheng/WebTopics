import { z } from "zod";
import { Server } from "socket.io";
import { TopicServer } from "./Server";
import { TopicClient } from "./Client";
import { ServiceChannel, TopicChannel } from "./utils/Channel";
import { createServiceChannel } from "./utils/createChannel";

const testChannel = createServiceChannel("test",
    z.object({
        a: z.number(),
        b: z.number()
    }),
    z.object({
        c: z.number()
    })
)

const socketIOServer = new Server(3000);
const topicServer = new TopicServer(socketIOServer);
topicServer.serve(testChannel, ({a, b}) => {
    return {
        c: a + b
    }
});

// Client 1
const topicClient1 = new TopicClient("http://localhost:3000");

// Client 2
const topicClient2 = new TopicClient("http://localhost:3000");

// Send updates regularly from client 1
setInterval(() => {
    topicClient1.req(testChannel, {a: 1, b: 2}, [topicClient1.serverID as string]).then((response) => {
        console.log(`Client 1 received response: ${JSON.stringify(response)}`)
    }).catch((error) => {
        // console.log(`Client 1 received error: ${error}`)
    });    
}, 1000);

// Send updates regularly from client 1
setInterval(() => {
    topicClient2.req(testChannel, {a: 2, b: 3}, [topicClient1.serverID as string]).then((response) => {
        console.log(`Client 2 received response: ${JSON.stringify(response)}`)
    }).catch((error) => {
        // console.log(`Client 2 received error: ${error}`)
    });    
}, 1500);