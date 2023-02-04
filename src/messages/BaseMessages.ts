import { z } from "zod";

// Generic message types

/**
 * Meta information about a message
 */
export const baseMetaMessageSchema = z.object({
    timestamp: z.number()
});
export type BaseMetaMessage = z.infer<typeof baseMetaMessageSchema>;

/**
 * Message requesting the full state
 * Could be:
 * - New client joining sending to server -> Server needs to process the message and send the unioned full state message from all clients
 * - Server broadcasting to all clients -> Client needs to process the message and send a full state message
 */
export const baseRequestFullStateMessageSchema = z.object({
    requestFullState: z.literal(true),
});
export type BaseRequestFullStateMessage = z.infer<typeof baseRequestFullStateMessageSchema>;

/**
 * Message containing the partial state
 */
export const baseStateMessageSchema = z.object({
    modified: z.record(z.unknown()),
    deleted: z.record(z.unknown())
});
export type BaseStateMessage = z.infer<typeof baseStateMessageSchema>;

export type WithBaseMeta<T> = T & { meta: BaseMetaMessage };