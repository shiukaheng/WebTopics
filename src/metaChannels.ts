import { z } from "zod";
import { createTopic, makeChannelMeta } from "./utils/createChannel";

export const serverMetaSchema = z.object({
    serverID: z.string(),
    clients: z.record(z.object({
        services: z.record(z.object({
            schema: z.object({}).passthrough(),
            responseSchema: z.object({}).passthrough().optional(),
        })),
    }))
});

export type ServerMeta = z.infer<typeof serverMetaSchema>;

export const serverMetaChannel = makeChannelMeta(createTopic(
    "serverMeta",
    serverMetaSchema
));