import z from "zod";
import { communityConfig } from "../config/community";
import {
	PostVisibility,
	ReportTargetType,
	ShareChannel,
} from "../models/Enums";

const visibilityValues = Object.values(PostVisibility) as [string, ...string[]];
const shareChannelValues = Object.values(ShareChannel) as [string, ...string[]];
const reportTargetValues = Object.values(ReportTargetType) as [
	string,
	...string[],
];
const reportReasonValues = [
	"spam",
	"harassment",
	"nudity",
	"violence",
	"misinformation",
	"other",
] as [string, ...string[]];

/** A reference to an already-uploaded image (returned by POST /community/media/images). */
export const imageReferenceSchema = z.object({
	url: z.string().min(1),
	thumbnailUrl: z.string().min(1).optional(),
	blurredUrl: z.string().min(1).optional(),
	position: z.number().int().min(0).optional(),
});

/** A reference to an already-uploaded audio clip (returned by POST /community/media/audio). */
export const audioReferenceSchema = z.object({
	url: z.string().min(1),
	duration: z
		.number()
		.int()
		.min(1)
		.max(communityConfig.maxAudioDurationSeconds),
});

/** Request body for POST /community/media/video/presign. */
export const videoPresignRequestSchema = z.object({
	filename: z.string().min(1).max(255),
	contentType: z.string().min(1),
	contentLength: z.number().int().positive(),
});

/** A reference to an already-uploaded video (S3 key from the presigned-PUT flow). */
export const videoReferenceSchema = z.object({
	s3Key: z.string().min(1),
});

export const createPostBodySchema = z
	.object({
		title: z.string().trim().max(120).optional().default(""),
		body: z.string().trim().max(5000).optional().default(""),
		/** Long-form companion field. Optional; max 5,000 chars. */
		description: z.string().trim().max(5000).optional().default(""),
		visibility: z.enum(visibilityValues).optional().default(PostVisibility.Public),
		images: z
			.array(imageReferenceSchema)
			.max(communityConfig.maxImagesPerPost)
			.optional()
			.default([]),
		audio: z
			.array(audioReferenceSchema)
			.max(communityConfig.maxAudioPerPost)
			.optional()
			.default([]),
		video: videoReferenceSchema.optional(),
	})
	.refine(
		(data) =>
			data.body.length > 0 ||
			data.images.length > 0 ||
			data.audio.length > 0 ||
			data.video !== undefined,
		{
			message:
				"A post must have text, at least one image, a video, or an audio clip",
			path: ["body"],
		},
	);

export const updatePostBodySchema = z
	.object({
		title: z.string().trim().max(120).optional(),
		body: z.string().trim().max(5000).optional(),
		/** Long-form companion field. Optional; max 5,000 chars. */
		description: z.string().trim().max(5000).optional(),
		visibility: z.enum(visibilityValues).optional(),
		images: z
			.array(imageReferenceSchema)
			.max(communityConfig.maxImagesPerPost)
			.optional(),
		audio: z
			.array(audioReferenceSchema)
			.max(communityConfig.maxAudioPerPost)
			.optional(),
		// null clears an existing video; undefined leaves it untouched.
		video: videoReferenceSchema.nullable().optional(),
	})
	.refine(
		(data) =>
			data.title !== undefined ||
			data.body !== undefined ||
			data.description !== undefined ||
			data.visibility !== undefined ||
			data.images !== undefined ||
			data.audio !== undefined ||
			data.video !== undefined,
		{ message: "Provide at least one field to update", path: ["body"] },
	);

export const feedQuerySchema = z.object({
	cursor: z.string().min(1).optional(),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(communityConfig.feed.maxPageSize)
		.optional(),
});

// ── Comments ────────────────────────────────────────────────────────────────
export const createCommentBodySchema = z.object({
	body: z.string().trim().min(1).max(2000),
	// A reply attaches to a top-level comment. Nesting beyond one level is
	// flattened onto the top-level parent by the service.
	parentId: z.string().min(1).optional(),
});

export const updateCommentBodySchema = z.object({
	body: z.string().trim().min(1).max(2000),
});

export const commentsQuerySchema = z.object({
	cursor: z.string().min(1).optional(),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(communityConfig.feed.maxPageSize)
		.optional(),
});

// ── Shares ──────────────────────────────────────────────────────────────────
export const shareBodySchema = z.object({
	channel: z.enum(shareChannelValues).optional().default(ShareChannel.Copy),
});

// ── Reports ─────────────────────────────────────────────────────────────────
export const reportBodySchema = z.object({
	targetType: z.enum(reportTargetValues),
	targetId: z.string().min(1),
	reason: z.enum(reportReasonValues),
	note: z.string().trim().max(1000).optional(),
});

export type CreatePostInput = z.infer<typeof createPostBodySchema>;
export type UpdatePostInput = z.infer<typeof updatePostBodySchema>;
export type CreateCommentInput = z.infer<typeof createCommentBodySchema>;
