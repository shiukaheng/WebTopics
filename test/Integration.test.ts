import { createService, createTopic, TopicClient, TopicServer } from "../src"
import { Server } from "socket.io"
import { afterAll, describe, expect, test } from "@jest/globals"
import { z } from "zod"
import { io, Socket } from "socket.io-client"

describe("Integration tests", ()=>{
    // Create server, clients, schemas, topics, services
    var server_created = false
    var socketServerPort = 0
    var socketServer: Server | undefined
    while (!server_created) {
        try {
            socketServerPort = Math.floor(Math.random() * 10000) + 10000
            socketServer = new Server(socketServerPort)
            server_created = true
        } catch (e) {
            console.log("Port already in use")
        }
    }
    if (socketServer === undefined) {
        throw new Error("Could not create server")
    }
    const topicServer = new TopicServer(socketServer)
    // Create topic
    const testTopicSchema = z.object({
        testString: z.string(),
        testNumber: z.number(),
    })
    const testTopic = createTopic("test", testTopicSchema)
    const testTopic2 = createTopic("test2", testTopicSchema)
    const testTopic3 = createTopic("test3", testTopicSchema)
    // Create service
    const testService = createService("test", z.object({
        a: z.number(),
        b: z.number()
    }),
        z.number()
    )
    const topicClient1 = new TopicClient(io(`http://localhost:${socketServerPort}`))
    const topicClient2 = new TopicClient(io(`http://localhost:${socketServerPort}`))
    // Initialize server with topics and services so they are handled / forwarded
    topicServer.initChannels([testTopic, testTopic2, testTopic3, testService])
    // === TESTS FOR TOPICS ===
    test("server should be able to publish topic, and client that joins later should be able to receive it", (done) => {
        console.log("Server publishing topic")
        topicServer.pub(testTopic, {
            testString: "test",
            testNumber: 1,
        })
        // Wait 2 seconds for the server to publish the topic
        setTimeout(() => {
            console.log("Client subscribing to topic")
            const unsub = topicClient1.sub(testTopic, (data) => {
                unsub()
                expect(data).toEqual({
                    testString: "test",
                    testNumber: 1,
                })
                done()
            })
        }, 2000)
    }, 3000)
    test("client1 should be able to publish topic, and client2 should be able to receive it", (done) => {
        console.log("Client1 publishing topic")
        topicClient1.pub(testTopic2, {
            testString: "test2",
            testNumber: 2,
        })
        // Wait 2 seconds for the server to publish the topic
        setTimeout(() => {
            console.log("Client2 subscribing to topic")
            const unsub = topicClient2.sub(testTopic2, (data) => {
                unsub()
                expect(data).toEqual({
                    testString: "test2",
                    testNumber: 2,
                })
                done()
            })
        }, 2000)
    }, 3000)
    // test("client1 should be able to publish topic, and server should be able to receive it", (done) => {
    //     console.log("Client1 publishing topic")
    //     topicClient1.pub(testTopic3, {
    //         testString: "test3",
    //         testNumber: 3,
    //     })
    //     // Wait 2 seconds for the server to publish the topic
    //     setTimeout(() => {
    //         console.log("Server subscribing to topic")
    //         const unsub = topicServer.sub(testTopic3, (data) => {
    //             unsub()
    //             expect(data).toEqual({
    //                 testString: "test3",
    //                 testNumber: 3,
    //             })
    //             done()
    //         })
    //     }, 2000)
    // }, 3000)
})