import { z } from "zod";
import { JSONValue } from "./JSON";

export const channelModeSchema = z.union([
    z.literal("topic"),
    z.literal("service"),
]);

export type ChannelMode = z.infer<typeof channelModeSchema>;

export type Channel<T extends JSONValue> = {
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

export type ServiceChannel<T extends JSONValue, U extends JSONValue> = Channel<T> & {
    mode: "service";
    responseSchema: z.ZodSchema<U>;
}

export const serviceChannelSchema = channelSchema.extend({
    mode: z.literal("service"),
    responseSchema: z.unknown(),
});

export type TopicChannel<T extends JSONValue> = Channel<T> & {
    mode: "topic";
}

export const topicChannelSchema = channelSchema.extend({
    mode: z.literal("topic"),
});