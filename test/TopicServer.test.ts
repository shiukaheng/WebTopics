import { createService, createTopic, TopicServer } from "../src"
import { Server } from "socket.io"
import { describe, expect, test } from "@jest/globals"
import { z } from "zod"

describe("TopicServer tests", () => {
    const server = new Server()
    var impl: TopicServer
    // Test constructor
    test("should be able to create a new TopicServer", () => {
        impl = new TopicServer(server)
        expect(impl).toBeDefined();
    })
    // === TESTS FOR TOPICS ===
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
    test("should be able to publish to a topic", () => {
        impl.pub(testTopic, {
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
        const unsub = impl.sub(testTopic, (data) => {
            expect(data).toBeDefined()
            done()
        })
        unsub()
    })
    test("should be able to unsubscribe from a topic", (done) => {
        var called = false
        const unsub = impl.sub(testTopic, (data) => {
            called = true
        }, false)
        unsub()
        impl.pub(testTopic, {
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
        const unsub = impl.sub(testTopic, (data) => {
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
        const unsub = impl.sub(testTopic, (data) => {
            // testString should be "test2" now
            expect(data.testString).toBe("test2")
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
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
        const unsub = impl.sub(testTopic, (data) => {
            // testString should be "test3" now
            expect(data.testString).toBe("test3")
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
            testString: "test3"
        }, true, false)
    })
    test("should be able to get new values when partial state is published - numbers", (done) => {
        // Subscribe first, then publish
        const unsub = impl.sub(testTopic, (data) => {
            // testNumber should be 2 now
            expect(data.testNumber).toBe(2)
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
            testNumber: 2
        }, true, false)
    })
    test("should be able to get new values when partial state is published - booleans", (done) => {
        // Subscribe first, then publish
        const unsub = impl.sub(testTopic, (data) => {
            // testBoolean should be false now
            expect(data.testBoolean).toBe(false)
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
            testBoolean: false
        }, true, false)
    })
    test("should be able to get new values when partial state is published - arrays", (done) => {
        // Subscribe first, then publish
        const unsub = impl.sub(testTopic, (data) => {
            // testArray should be ["test2"] now
            expect(data.testArray).toEqual(["test2"])
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
            testArray: ["test2"]
        }, true, false)
    })
    test("should be able to get new values when partial state is published - objects", (done) => {
        // Subscribe first, then publish
        const unsub = impl.sub(testTopic, (data) => {
            // testObject should be { testNestedString: "test2" } now
            expect(data.testObject).toEqual({ testNestedString: "test2" })
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
            testObject: { testNestedString: "test2" }
        }, true, false)
    })
    test("should be able to get new values when partial state is published - nested objects", (done) => {
        // Subscribe first, then publish
        const unsub = impl.sub(testTopic, (data) => {
            // testObject.testNestedString should be "test3" now
            expect(data.testObject.testNestedString).toBe("test3")
            done()
            unsub()
        }, false)
        impl.pub(testTopic, {
            testObject: { testNestedString: "test3" }
        }, true, false)
    })
    test("should not receive errors if a topic is published with invalid data", (done) => {
        var called = false
        const unsub = impl.sub(testTopic, (data) => {
            called = true
        }, false) // False so we don't get the initial value
        impl.pub(testTopic, {
            testString: 1 as any,
        }, true, false)
        setTimeout(() => {
            expect(called).toBe(false)
            done()
            unsub()
        }, 100)
    })
    // === TESTS FOR SERVICES ===
    const testService = createService("test", z.object({
        a: z.number(),
        b: z.number()
    }),
        z.number()
    )
    test("should be able to serve a service", (done) => {
        impl.srv(testService, (data) => {
            return data.a + data.b
        })
        impl.req(testService, {
            a: 1,
            b: 2
        }, impl.id).then((data) => {
            expect(data).toBe(3)
            done()
        })
    })
    const testVoidService = createService("testVoid", z.object({
        a: z.number()
    }))
    test("should be able to serve a service with void return type", (done) => {
        impl.srv(testVoidService, (data) => {
            expect(data.a).toBe(1)
        })
        impl.req(testVoidService, {
            a: 1
        }, impl.id).then((data) => {
            expect(data).toBeUndefined()
            done()
        })
    })
})
