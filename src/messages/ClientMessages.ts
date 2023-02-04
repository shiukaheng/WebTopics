import { z } from "zod";
import { baseMetaMessageSchema, baseStateMessageSchema, baseRequestFullStateMessageSchema } from "./BaseMessages";

// Client specific message types

/**
 * Raw messages with meta information
 */
export const clientMessageTypesSchema = z.union([baseRequestFullStateMessageSchema, baseStateMessageSchema]);
export type ClientMessageTypes = z.infer<typeof clientMessageTypesSchema>;

/**
 * Client message meta information
 */
export const clientMetaMessageSchema = baseMetaMessageSchema.and(z.object({
    clientId: z.string()
}));
export type ClientMetaMessage = z.infer<typeof clientMetaMessageSchema>;

// Full message with meta information and message type

/**
 * State message
 */
export const clientStateMessageSchema = clientMetaMessageSchema.and(clientMessageTypesSchema);
export type ClientStateMessage = z.infer<typeof baseStateMessageSchema>;

/**
 * Request full state message
 */
export const clientRequestFullStateMessageSchema = clientMetaMessageSchema.and(baseRequestFullStateMessageSchema);
export type ClientRequestFullStateMessage = z.infer<typeof baseRequestFullStateMessageSchema>;

export type WithClientMeta<T> = T & { meta: ClientMetaMessage };