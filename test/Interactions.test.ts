import { createService, createTopic, TopicClient, TopicServer } from "../src"
import { Server } from "socket.io"
import { afterAll, describe, expect, test } from "@jest/globals"
import { z } from "zod"
import { io, Socket } from "socket.io-client"

describe("TopicClient tests", () => {
    // // Create server
    // var server_created = false
    // var socketServerPort = 0
    // var socketServer: Server | undefined
    // while (!server_created) {
    //     try {
    //         socketServerPort = Math.floor(Math.random() * 10000) + 10000
    //         socketServer = new Server(socketServerPort)
    //         server_created = true
    //     } catch (e) {
    //         console.log("Port already in use")
    //     }
    // }
    // // Create client
    // if (socketServer === undefined) {
    //     throw new Error("Could not create server")
    // }
    // const topicServer = new TopicServer(socketServer)
    // // Create topic
    // const testTopicSchema = z.object({
    //     requiredString: z.string(),
    //     testString: z.string().optional(),
    //     testNumber: z.number().optional(),
    //     testBoolean: z.boolean().optional(),
    // })
    // const testTopic = createTopic("test", testTopicSchema)
    // var topicClient1: TopicClient;
    // var topicClient2: TopicClient;
    // var socketClient = io(`http://localhost:${socketServerPort}`)
    // // Initalize server with topics and services so they are handled / forwarded
    // topicServer.initChannels([testTopic])
    // // Create clients
    // test("should be able to create a new TopicClient, and initialize topic", () => {
    //     topicClient1 = new TopicClient(socketClient)
    //     topicClient2 = new TopicClient(socketClient)
    //     expect(topicClient1).toBeDefined();
    //     expect(topicClient2).toBeDefined();
    // })
    // // === TESTS FOR TOPICS ===
    // test("should be able to subscribe to a topic, and have information passed through", (done) => {
    //     const unsub1 = topicClient1.sub(testTopic, (data) => {
    //         expect(data.testString).toEqual("test")
    //         console.log("Received data on client 1", data)
    //     }, false)
    //     const unsub2 = topicClient2.sub(testTopic, (data) => {
    //         expect(data.testString).toEqual("test")
    //         console.log("Received data on client 2", data)
    //         done()
    //         unsub1()
    //         unsub2()
    //     }, false)
    //     topicClient1.pub(testTopic, {
    //         requiredString: "test",
    //         testString: "test",
    //     })
    // })
})