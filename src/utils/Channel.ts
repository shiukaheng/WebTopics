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