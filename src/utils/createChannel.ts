import { z } from "zod";
import { ServiceChannel, TopicChannel } from "./Channel";
import { JSONValue } from "./JSON";

/**
 * Creates a topic channel object with the given name and schema
 * @param name Name of the channel
 * @param schema Schema of the channel
 * @returns The topic channel object
 */
export function createTopic<T extends JSONValue>(name: string, schema: z.ZodSchema<T>): TopicChannel<T> {
    return {
        mode: "topic",
        name,
        schema
    }
}

/**
 * Creates a service channel object with the given name, request schema, and response schema
 * @param name Name of the channel
 * @param requestSchema The schema of the request
 * @param responseSchema The schema of the response
 * @returns The service channel object
 */
export function createService<T extends JSONValue, R extends JSONValue>(name: string, requestSchema: z.ZodSchema<T>, responseSchema: z.ZodSchema<R>): ServiceChannel<T, R> {
    return {
        mode: "service",
        name,
        schema: requestSchema,
        responseSchema
    }
}

/**
 * Adds a meta property to a channel object
 * @param channel The channel to add the meta property to
 * @returns The channel with the meta property
 */
export function makeChannelMeta<T>(channel: T): T & { meta: true } {
    return {
        ...channel,
        meta: true
    };
}