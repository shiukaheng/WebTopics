import { createTopic, TopicClient, TopicServer } from ".";
import { Server } from "socket.io";
import { io } from "socket.io-client";
import { z } from "zod";

const sampleSchema = z.number();
type Sample = z.infer<typeof sampleSchema>;

const sampleTopic = createTopic("sample", sampleSchema);

const topicServer = new TopicServer(new Server(3000, {
    cors: {
        origin: "*",
    },
}));
topicServer.initChannels([sampleTopic]);
topicServer.pub(sampleTopic, 0);

setInterval(() => {
    topicServer.pub(sampleTopic, topicServer.getTopicSync(sampleTopic)+1)
    console.log("Published", topicServer.getTopicSync(sampleTopic))
}, 1000);

const topicClient = new TopicClient(io("http://localhost:3000"));
topicClient.sub(sampleTopic, (data) => {
});