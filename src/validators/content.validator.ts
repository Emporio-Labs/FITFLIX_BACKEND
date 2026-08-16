import z from "zod";
import { CONTENT_PLATFORMS } from "../models/ContentOverride";

/**
 * Mirrors the model's key rule. Kept in both places on purpose: the schema
 * guards direct writes and migrations, this guards the API and is what
 * produces a readable 400 instead of a Mongoose validation dump.
 */
const KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const contentFields = z.object({
	key: z
		.string()
		.trim()
		.min(1)
		.max(120)
		.regex(
			KEY_PATTERN,
			"Key must be lowercase dotted segments, e.g. visitor.hero.title",
		),
	// Empty string is allowed: hiding a line by overriding it to nothing is a
	// legitimate edit, and is different from deleting the row (which restores
	// the app's baked-in default).
	value: z.string().max(2000),
	// Null is meaningful — it means every platform. Distinct from absent on an
	// update, which leaves the stored value alone.
	platform: z.enum(CONTENT_PLATFORMS).nullable().optional(),
	note: z.string().trim().max(500).optional(),
	isActive: z.boolean().optional(),
});

export const createContentOverrideSchema = contentFields;

export const updateContentOverrideSchema = contentFields
	.partial()
	.superRefine((p, ctx) => {
		if (Object.keys(p).length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "At least one field is required",
			});
		}
	});

export type CreateContentOverrideInput = z.infer<
	typeof createContentOverrideSchema
>;
export type UpdateContentOverrideInput = z.infer<
	typeof updateContentOverrideSchema
>;
