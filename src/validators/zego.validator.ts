import z from "zod";

/// The room is derived server-side from the caller's booking, so the client has
/// nothing to send. Deliberately strict: accepting a client-supplied room id
/// here would let any authenticated user mint a token for any room.
export const videoTokenParamsSchema = z.object({
	sessionId: z.string().trim().min(1),
});

export type VideoTokenParams = z.infer<typeof videoTokenParamsSchema>;
