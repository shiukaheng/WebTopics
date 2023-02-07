import { z } from "zod";
import { ServiceChannel, TopicChannel } from "./Channel";
import { JSONValue } from "./JSON";

export function createTopic<T extends JSONValue>(name: string, schema: z.ZodSchema<T>): TopicChannel<T> {
    return {
        mode: "topic",
        name,
        schema
    }
}

export function createChannel<T extends JSONValue, R extends JSONValue>(name: string, requestSchema: z.ZodSchema<T>, responseSchema: z.ZodSchema<R>): ServiceChannel<T, R> {
    return {
        mode: "service",
        name,
        schema: requestSchema,
        responseSchema
    }
}