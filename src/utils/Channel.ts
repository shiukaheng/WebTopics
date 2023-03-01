import { z } from "zod";
import { JSONValue } from "./JSON";

export const channelModeSchema = z.union([
    z.literal("topic"),
    z.literal("service"),
]);
export type RequestType = JSONValue | void;
export type ChannelMode = z.infer<typeof channelModeSchema>;

export type Channel<T extends RequestType> = { // While the general channel type supports void, topic channels should not support void since it makes no sense to have a topic channel with no data
    /**
     * The name of the channel (prefixes will be added automatically, ensuring topic and service channels of the same name are unique)
     */
    name: string;
    /**
     * The mode of the channel
     */
    mode: ChannelMode;
    /**
     * The schema of the channel
     */
    schema: z.ZodSchema<T>;
    /**
     * Whether the channel is a meta channel (not meant to be used by the user)
     */
    meta?: boolean;
}

export const channelSchema = z.object({
    name: z.string(),
    mode: channelModeSchema,
    schema: z.unknown(),
    meta: z.boolean().optional(),
});

export type ServiceResponseType = JSONValue | void;

export type ServiceChannel<T extends RequestType=void, U extends ServiceResponseType=void> = Channel<T> & {
    mode: "service";
    responseSchema: z.ZodSchema<U>;
}

/**
 * Extractor type for getting the callback type of a service channel
 */
export type ServiceChannelCallback<T extends ServiceChannel> = T extends ServiceChannel<infer T, infer U> ? (request: T) => Promise<U> : never;

export const serviceChannelSchema = channelSchema.extend({
    mode: z.literal("service"),
    responseSchema: z.unknown(),
});

export type TopicChannel<T extends JSONValue> = Channel<T> & {
    mode: "topic";
}

/**
 * Extractor type for getting the data type of a topic channel
 */
export type TopicChannelData<T extends TopicChannel<any>> = T extends TopicChannel<infer T> ? T : never;

export const topicChannelSchema = channelSchema.extend({
    mode: z.literal("topic"),
});