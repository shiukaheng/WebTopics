import { z } from "zod";

// Generic message types

export const messageTypeSchema = z.union([
    z.literal("topic"),
    z.literal("requestFullTopic"),
    z.literal("service"),
    z.literal("serviceResponse"),
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
 * Message requesting the full topic
 * Could be:
 * - New client joining sending to server -> Server needs to process the message and send the unioned full topic message from all clients
 * - Server broadcasting to all clients -> Client needs to process the message and send a full topic message
 */
export const requestFullTopicMessageSchema = z.object({
});
export type RequestFullTopicMessage = z.infer<typeof requestFullTopicMessageSchema>;

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
 * Message containing the partial topic
 */
export const topicMessageSchema = z.object({
    modified: jsonValueSchema.optional(),
    deleted: jsonValueSchema.optional()
});
export type TopicMessage = z.infer<typeof topicMessageSchema>;

/**
 * Message for a service
 */
export const serviceMessageSchema = z.object({
    serviceData: jsonValueSchema,
    serviceId: z.string(), // For matching up responses,
    dest: z.union([
        z.array(z.string()),
        z.literal("*")
    ]), // Allow multiple clients to receive the same message
});
export type ServiceMessage = z.infer<typeof serviceMessageSchema>;

/**
 * Message for a service response
 */
export const serviceResponseMessageSchema = z.object({
    responseData: jsonValueSchema,
    serviceId: z.string(),
    dest: z.string(), // A service is only possibly requested by one client
    noHandler: z.boolean().optional(),
});
export type ServiceResponseMessage = z.infer<typeof serviceResponseMessageSchema>;

export type WithMeta<T> = T & MessageMeta;