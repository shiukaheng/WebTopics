import { z } from "zod";
import { baseMetaMessageSchema, baseStateMessageSchema, baseRequestFullStateMessageSchema, BaseMetaMessage } from "./BaseMessages";

// Server specific message types

/**
 * Raw messages with meta information
 */
export const serverMessageTypesSchema = z.union([baseRequestFullStateMessageSchema, baseStateMessageSchema]);
export type ServerMessageTypes = z.infer<typeof serverMessageTypesSchema>;

// Full message with meta information and message type

/**
 * Server state message
 */
export const serverStateMessageSchema = baseMetaMessageSchema.and(serverMessageTypesSchema);
export type ServerStateMessage = z.infer<typeof baseStateMessageSchema>;

/**
 * Server request full state message
 */
export const serverRequestFullStateMessageSchema = baseMetaMessageSchema.and(baseRequestFullStateMessageSchema);
export type ServerRequestFullStateMessage = z.infer<typeof baseRequestFullStateMessageSchema>;

export type WithServerMeta<T> = T & { meta: BaseMetaMessage };