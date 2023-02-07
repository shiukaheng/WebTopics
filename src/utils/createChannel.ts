import { z } from "zod";
import { CommandChannel, StateChannel } from "./Channel";
import { JSONValue } from "./JSON";

export function createStateChannel<T extends JSONValue>(name: string, schema: z.ZodSchema<T>): StateChannel<T> {
    return {
        mode: "state",
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