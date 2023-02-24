import { createService, createTopic, TopicClient, TopicServer } from "../src"
import { Server } from "socket.io"
import { afterAll, describe, expect, test } from "@jest/globals"
import { z } from "zod"
import { io, Socket } from "socket.io-client"

describe("TopicClient tests", () => {
    // Create server
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
        testBoolean: z.boolean(),
        testArray: z.array(z.string()),
        testObject: z.object({
            testNestedString: z.string()
        })
    })
    const testTopic = createTopic("test", testTopicSchema)
    // Create service
    const testService = createService("test", z.object({
        a: z.number(),
        b: z.number()
    }),
        z.number()
    )
    var topicClient: TopicClient;
    var socketClient = io(`http://localhost:${socketServerPort}`)
    // Initalize server with topics and services so they are handled / forwarded
    topicServer.initChannels([testTopic, testService])
    // Create clients
    test("should be able to create a new TopicClient", () => {
        topicClient = new TopicClient(socketClient)
        expect(topicClient).toBeDefined();
    })
    // === TESTS FOR TOPICS ===
    test("should be able to publish to a topic", () => {
        topicClient.pub(testTopic, {
            testString: "test",
            testNumber: 1,
            testBoolean: true,
            testArray: ["test"],
            testObject: {
                testNestedString: "test"
            }
        })
    })
    test("should be able to subscribe to a topic, and get its initial value if its available", (done) => {
        const unsub = topicClient.sub(testTopic, (data) => {
            expect(data).toBeDefined()
            done()
        })
        unsub()
    })
    test("should be able to unsubscribe from a topic", (done) => {
        var called = false
        const unsub = topicClient.sub(testTopic, (data) => {
            called = true
        }, false)
        unsub()
        topicClient.pub(testTopic, {
            testString: "initial",
            testNumber: 1,
            testBoolean: true,
            testArray: ["test"],
            testObject: {
                testNestedString: "test"
            }
        })
        setTimeout(() => {
            expect(called).toBe(false)
            done()
        }, 100)
    })
    test("should be able to subscribe to a topic, and not get its initial value if its available, if initialUpdate is false", (done) => {
        var called = false
        const unsub = topicClient.sub(testTopic, (data) => {
            called = true
        }, false)
        setTimeout(() => {
            expect(called).toBe(false)
            done()
            unsub()
        }, 100)
    })
    test("should be able to get new values when complete state is published", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testString should be "test2" now
            expect(data.testString).toBe("test2")
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testString: "test2",
            testNumber: 1,
            testBoolean: true,
            testArray: ["test"],
            testObject: {
                testNestedString: "test"
            }
        })
    })
    test("should be able to get new values when partial state is published - strings", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testString should be "test3" now
            expect(data.testString).toBe("test3")
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testString: "test3"
        }, true, false)
    })
    test("should be able to get new values when partial state is published - numbers", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testNumber should be 2 now
            expect(data.testNumber).toBe(2)
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testNumber: 2
        }, true, false)
    })
    test("should be able to get new values when partial state is published - booleans", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testBoolean should be false now
            expect(data.testBoolean).toBe(false)
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testBoolean: false
        }, true, false)
    })
    test("should be able to get new values when partial state is published - arrays", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testArray should be ["test2"] now
            expect(data.testArray).toEqual(["test2"])
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testArray: ["test2"]
        }, true, false)
    })
    test("should be able to get new values when partial state is published - objects", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testObject should be { testNestedString: "test2" } now
            expect(data.testObject).toEqual({ testNestedString: "test2" })
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testObject: { testNestedString: "test2" }
        }, true, false)
    })
    test("should be able to get new values when partial state is published - nested objects", (done) => {
        // Subscribe first, then publish
        const unsub = topicClient.sub(testTopic, (data) => {
            // testObject.testNestedString should be "test3" now
            expect(data.testObject.testNestedString).toBe("test3")
            done()
            unsub()
        }, false)
        topicClient.pub(testTopic, {
            testObject: { testNestedString: "test3" }
        }, true, false)
    })
    test("should not receive errors if a topic is published with invalid data", (done) => {
        var called = false
        const unsub = topicClient.sub(testTopic, (data) => {
            called = true
        }, false) // False so we don't get the initial value
        topicClient.pub(testTopic, {
            testString: 1 as any,
        }, true, false)
        setTimeout(() => {
            expect(called).toBe(false)
            done()
            unsub()
        }, 100)
    })
    // === TESTS FOR SERVICES ===
    test("should be able to serve a service", (done) => {
        topicClient.srv(testService, (data) => {
            return data.a + data.b
        })
        topicClient.req(testService, topicClient.id, {
            a: 1,
            b: 2
        }).then((data) => {
            expect(data).toBe(3)
            done()
        })
    })
    const testVoidService = createService("testVoid", z.object({
        a: z.number()
    }))
    topicServer.initChannels([testVoidService])
    test("should be able to serve a service with void return type", (done) => {
        topicClient.srv(testVoidService, (data) => {
            expect(data.a).toBe(1)
        })
        topicClient.req(testVoidService, topicClient.id, {
            a: 1
        }).then((data) => {
            expect(data).toBeUndefined()
            done()
        })
    })
    const testDoubleVoidService = createService("testDoubleVoid")
    topicServer.initChannels([testDoubleVoidService])
    test("should be able to serve a service with void return type and void input type", (done) => {
        topicClient.srv(testDoubleVoidService, (data) => {
            expect(data).toBeUndefined()
        })
        topicClient.req(testDoubleVoidService, topicClient.id).then((data) => {
            expect(data).toBeUndefined()
            done()
        })
    })
    const testAsyncService = createService("testAsync", z.number(), z.number())
    topicServer.initChannels([testAsyncService])
    test("should be able to serve a service with a async function", (done) => {
        topicClient.srv(testAsyncService, async (data) => {
            // Set 5ms timeout to simulate async
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(data + 1)
                }, 5)
            })
        })
        topicClient.req(testAsyncService, topicClient.id, 1).then((data) => {
            expect(data).toBe(2)
            done()
        })
    })
    const testAsyncTimeoutService = createService("testAsyncTimeout", z.number(), z.number())
    topicServer.initChannels([testAsyncTimeoutService])
    test("should return a client-side timeout error if a service takes too long to respond", (done) => {
        const timeNow = Date.now()
        console.log("Testing timeout")
        topicClient.srv(testAsyncTimeoutService, async (data) => {
            // Set 10 second timeout to simulate long async
            return await new Promise((resolve) => {
                setTimeout(() => {
                    resolve(data + 1)
                }, 10000)
            })
        })
        topicClient.req(testAsyncTimeoutService, topicClient.id, 1).then((data) => { // Defaults to 100ms timeout
            console.log("This should not be called")
        }).catch((err) => {
            // Log time taken
            console.log("Time taken: " + (Date.now() - timeNow))
            expect(err).toBeInstanceOf(Error)
            console.log(err)
            done()
        })
    })
    // Destroy socket.io server and clients. Disconnection messages are expected, since only the socket is closed, not the server
    afterAll(() => {
        socketServer?.close()
        socketClient?.close()
    })
})