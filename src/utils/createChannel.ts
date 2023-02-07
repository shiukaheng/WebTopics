import { z } from "zod";
import { CommandChannel, TopicChannel } from "./Channel";
import { JSONValue } from "./JSON";

export function createTopicChannel<T extends JSONValue>(name: string, schema: z.ZodSchema<T>): TopicChannel<T> {
    return {
        mode: "topic",
        name,
        schema
    }
}

export function createCommandChannel<T extends JSONValue, R extends JSONValue>(name: string, schema: z.ZodSchema<T>, responseSchema: z.ZodSchema<R>): CommandChannel<T, R> {
    return {
        mode: "command",
        name,
        schema,
        responseSchema
    }
}