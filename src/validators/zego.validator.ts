import z from "zod";

/// The room is derived server-side from the caller's booking, so the client has
/// nothing to send. Deliberately strict: accepting a client-supplied room id
/// here would let any authenticated user mint a token for any room.
export const videoTokenParamsSchema = z.object({
	sessionId: z.string().trim().min(1),
});

export type VideoTokenParams = z.infer<typeof videoTokenParamsSchema>;

export const sendRoomMessageBodySchema = z.object({
	body: z.string().trim().min(1).max(2000),
	zegoMessageId: z.string().trim().min(1).max(200).optional(),
	sentAt: z.coerce.date().optional(),
});

export type SendRoomMessageBody = z.infer<typeof sendRoomMessageBodySchema>;

export const listRoomMessagesQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional(),
});

export type ListRoomMessagesQuery = z.infer<typeof listRoomMessagesQuerySchema>;
