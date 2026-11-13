import { z } from "zod";
import { PhotoPose } from "../models/Enums";

export const uploadProgressPhotoSchema = z.object({
	pose: z.enum([PhotoPose.Front, PhotoPose.Side, PhotoPose.Back]),
	recordedDate: z.string().trim().optional(),
	capturedAt: z.string().trim().optional(),
	weightKg: z
		.preprocess((v) => {
			if (v === "" || v === null || v === undefined) return undefined;
			const n = Number(v);
			return Number.isNaN(n) ? undefined : n;
		}, z.number().positive().max(300).optional())
		.optional(),
	notes: z
		.preprocess((v) => {
			if (typeof v === "string" && v.trim() === "") return undefined;
			return v;
		}, z.string().trim().max(500).optional())
		.optional(),
	isPrivateToSelf: z
		.preprocess((v) => {
			if (typeof v === "string") {
				return v.toLowerCase() === "true" || v === "1";
			}
			return Boolean(v);
		}, z.boolean().optional())
		.default(false),
});

export const progressPhotosQuerySchema = z.object({
	from: z.string().trim().optional(),
	to: z.string().trim().optional(),
	pose: z.enum([PhotoPose.Front, PhotoPose.Side, PhotoPose.Back]).optional(),
	limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const comparePhotosQuerySchema = z.object({
	dateA: z.string().trim().min(1, "dateA is required"),
	dateB: z.string().trim().min(1, "dateB is required"),
	pose: z.enum([PhotoPose.Front, PhotoPose.Side, PhotoPose.Back]).optional(),
});

export type UploadProgressPhotoBody = z.infer<typeof uploadProgressPhotoSchema>;
export type ProgressPhotosQuery = z.infer<typeof progressPhotosQuerySchema>;
export type ComparePhotosQuery = z.infer<typeof comparePhotosQuerySchema>;
