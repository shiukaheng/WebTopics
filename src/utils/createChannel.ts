import { z } from "zod";
import { ServiceChannel, TopicChannel } from "./Channel";
import { JSONValue } from "./JSON";

export function createTopicChannel<T extends JSONValue>(name: string, schema: z.ZodSchema<T>): TopicChannel<T> {
    return {
        mode: "topic",
        name,
        schema
    }
}

export function createServiceChannel<T extends JSONValue, R extends JSONValue>(name: string, schema: z.ZodSchema<T>, responseSchema: z.ZodSchema<R>): ServiceChannel<T, R> {
    return {
        mode: "service",
        name,
        schema,
        responseSchema
    }
}