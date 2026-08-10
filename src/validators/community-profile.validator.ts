import { z } from "zod";
import { communityConfig } from "../config/community";

/**
 * Profile edit. Both fields are optional but at least one must be present, so
 * an empty PATCH is a client bug rather than a silent no-op.
 *
 * An explicitly-sent empty string is LEGAL and means "clear this field" —
 * matching how the post editor treats an empty title.
 */
export const updateProfileBodySchema = z
	.object({
		displayName: z
			.string()
			.trim()
			.max(communityConfig.profile.maxDisplayNameLength)
			.optional(),
		bio: z.string().trim().max(communityConfig.profile.maxBioLength).optional(),
	})
	.refine((data) => data.displayName !== undefined || data.bio !== undefined, {
		message: "Provide at least one field to update",
		path: ["bio"],
	});

export const peopleSearchQuerySchema = z.object({
	q: z.string().trim().min(1).max(60),
	cursor: z.string().min(1).optional(),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(communityConfig.feed.maxPageSize)
		.optional(),
});

/** A profile's post list pages exactly like the feed. */
export const userPostsQuerySchema = z.object({
	cursor: z.string().min(1).optional(),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(communityConfig.feed.maxPageSize)
		.optional(),
});
