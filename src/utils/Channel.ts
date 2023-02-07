import { z } from "zod";
import { JSONValue } from "./JSON";

export const channelModeSchema = z.union([
    z.literal("topic"),
    z.literal("command"),
]);

export type ChannelMode = z.infer<typeof channelModeSchema>;

export type Channel<T extends JSONValue> = {
    name: string;
    mode: ChannelMode;
    schema: z.ZodSchema<T>;
}

export const channelSchema = z.object({
    name: z.string(),
    mode: channelModeSchema,
    schema: z.unknown(),
});

export type CommandChannel<T extends JSONValue, U extends JSONValue> = Channel<T> & {
    mode: "command";
    responseSchema: z.ZodSchema<U>;
}

export const commandChannelSchema = channelSchema.extend({
    mode: z.literal("command"),
    responseSchema: z.unknown(),
});

export type TopicChannel<T extends JSONValue> = Channel<T> & {
    mode: "topic";
}

export const topicChannelSchema = channelSchema.extend({
    mode: z.literal("topic"),
});