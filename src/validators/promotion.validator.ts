import mongoose from "mongoose";
import z from "zod";
import {
	PROMOTION_AUDIENCES,
	PROMOTION_LINK_TYPES,
	PROMOTION_MODES,
} from "../models/Promotion";

const objectId = z
	.string()
	.trim()
	.refine((v) => mongoose.Types.ObjectId.isValid(v), "Expected an object id");

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The link targets do not agree on an id type. Class uses a randomUUID string
 * `_id`; Therapy and MembershipPlan use ObjectIds. Validating per type is what
 * stops a promotion pointing at an id that cannot exist in its own collection.
 */
const targetIdMatchesType = (type: string, targetId: string): boolean =>
	type === "class"
		? UUID_RE.test(targetId)
		: mongoose.Types.ObjectId.isValid(targetId);

/**
 * A link either points at something we own or at a URL — never both, never
 * neither. Mongoose can't express that, so it is enforced here and the model
 * keeps both fields nullable.
 */
const linkSchema = z
	.object({
		type: z.enum(PROMOTION_LINK_TYPES),
		targetId: z.string().trim().min(1).optional(),
		url: z.string().trim().url().optional(),
	})
	.superRefine((link, ctx) => {
		if (link.type === "url") {
			if (!link.url) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["url"],
					message: 'url is required when link type is "url"',
				});
			}
			if (link.targetId) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["targetId"],
					message: 'targetId is not allowed when link type is "url"',
				});
			}
			return;
		}

		if (!link.targetId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["targetId"],
				message: `targetId is required when link type is "${link.type}"`,
			});
		} else if (!targetIdMatchesType(link.type, link.targetId)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["targetId"],
				message:
					link.type === "class"
						? "A class targetId must be a UUID"
						: `A ${link.type} targetId must be an object id`,
			});
		}
		if (link.url) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["url"],
				message: `url is not allowed when link type is "${link.type}"`,
			});
		}
	});

const promotionFields = z.object({
	// Omitted or null means company-wide.
	locationId: objectId.nullable().optional(),
	title: z.string().trim().min(1),
	imageUrl: z.string().trim().url(),
	subtext: z.string().trim().optional(),
	tag: z.string().trim().optional(),
	// Null is meaningful: it matches both audiences. Distinct from absent on
	// an update, which leaves the stored value alone.
	mode: z.enum(PROMOTION_MODES).nullable().optional(),
	// Unlike `mode`, null is not meaningful here — "everyone" is spelled "all",
	// so the enum stays closed and the filter never has to special-case it.
	audience: z.enum(PROMOTION_AUDIENCES).optional(),
	ctaLabel: z.string().trim().max(40).optional(),
	link: linkSchema,
	activeFrom: z.coerce.date(),
	activeTo: z.coerce.date(),
	priority: z.coerce.number().int().optional(),
	isActive: z.boolean().optional(),
});

const endsAfterItStarts = (
	p: { activeFrom?: Date; activeTo?: Date },
	ctx: z.RefinementCtx,
) => {
	if (p.activeFrom && p.activeTo && p.activeTo <= p.activeFrom) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["activeTo"],
			message: "activeTo must be after activeFrom",
		});
	}
};

export const createPromotionSchema = promotionFields.superRefine(
	endsAfterItStarts,
);

/**
 * A partial update can move one end of the window without the other, so the
 * ordering check can only run against the merged document — the controller
 * re-validates there. This catches the case where both are sent at once.
 */
export const updatePromotionSchema = promotionFields
	.partial()
	.superRefine((p, ctx) => {
		if (Object.keys(p).length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "At least one field is required",
			});
		}
		endsAfterItStarts(p, ctx);
	});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
