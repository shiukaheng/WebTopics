import { z } from "zod";
import { JSONValue } from "./JSON";

export const channelModeSchema = z.union([
    z.literal("state"),
    z.literal("command"),
]);

export type ChannelMode = z.infer<typeof channelModeSchema>;

export type Channel<T extends JSONValue> = {
    name: string;
    mode: ChannelMode;
    schema: z.ZodSchema<T>;
    responseSchema?: z.ZodSchema<T>;
}

export const channelSchema = z.object({
    name: z.string(),
    mode: channelModeSchema,
    schema: z.unknown(),
    responseSchema: z.unknown().optional(),
});

export type CommandChannel<T extends JSONValue> = Channel<T> & {
    mode: "command";
    responseSchema: z.ZodSchema<T>;
}

export const commandChannelSchema = channelSchema.extend({
    mode: z.literal("command"),
    responseSchema: z.unknown(),
});

export type StateChannel<T extends JSONValue> = Channel<T> & {
    mode: "state";
}

export const stateChannelSchema = channelSchema.extend({
    mode: z.literal("state"),
});

