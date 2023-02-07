import { z } from "zod";

// Generic message types

export const messageTypeSchema = z.union([
    z.literal("state"),
    z.literal("requestFullState"),
    z.literal("command"),
    z.literal("commandResponse"),
])
export type MessageType = z.infer<typeof messageTypeSchema>;

/**
 * Meta information about a message
 */
export const metaMessageSchema = z.object({
    timestamp: z.number(),
    messageType: messageTypeSchema,
    source: z.string(),
});

export type MessageMeta = z.infer<typeof metaMessageSchema>;

/**
 * Message requesting the full state
 * Could be:
 * - New client joining sending to server -> Server needs to process the message and send the unioned full state message from all clients
 * - Server broadcasting to all clients -> Client needs to process the message and send a full state message
 */
export const requestFullStateMessageSchema = z.object({
    requestFullState: z.literal(true),
});
export type RequestFullStateMessage = z.infer<typeof requestFullStateMessageSchema>;

export const jsonValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({}).passthrough(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.unknown()),
]);

/**
 * Message containing the partial state
 */
export const stateMessageSchema = z.object({
    modified: jsonValueSchema.optional(),
    deleted: jsonValueSchema.optional()
});
export type StateMessage = z.infer<typeof stateMessageSchema>;

/**
 * Message for a command
 */
export const commandMessageSchema = z.object({
    commandData: jsonValueSchema,
    commandId: z.string(), // For matching up responses,
    dest: z.union([
        z.array(z.string()),
        z.literal("*")
    ]), // Allow multiple clients to receive the same message
});
export type CommandMessage = z.infer<typeof commandMessageSchema>;

/**
 * Message for a command response
 */
export const commandResponseMessageSchema = z.object({
    responseData: jsonValueSchema,
    commandId: z.string(),
    dest: z.string(), // A command is only possibly requested by one client
    noHandler: z.boolean().optional(),
});
export type CommandResponseMessage = z.infer<typeof commandResponseMessageSchema>;

export type WithMeta<T> = T & MessageMeta;