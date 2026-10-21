import z from "zod";
import { MembershipStatus } from "../models/Enums";

const membershipStatusValues = Object.values(MembershipStatus).map(String);

export const createMembershipBodySchema = z.object({
	userId: z.string().trim().optional(),
	planName: z.string().trim().min(1),
	creditsIncluded: z.coerce.number().int().nonnegative().default(0),
	status: z.enum(membershipStatusValues as [string, ...string[]]).optional(),
	price: z.number().nonnegative(),
	currency: z.string().trim().min(1).default("USD"),
	startDate: z.string().trim().min(1),
	endDate: z.string().trim().optional(),
	features: z.array(z.string().trim().min(1)).default([]),
	notes: z.string().trim().optional(),
	/** The branch this membership is issued at. Resolved by resolveLocationId. */
	locationId: z.string().trim().optional(),
	/** Optional effective resume date (e.g. backdated return date) when transitioning Paused -> Active */
	resumedAt: z.string().trim().optional(),
	/** Optional reason / note for freeze or resume */
	reason: z.string().trim().optional(),
});

/**
 * POST /memberships: an admin creating a membership by hand, outside the
 * invoice flow. The reason is mandatory and stored on the membership.
 */
export const createManualMembershipBodySchema = createMembershipBodySchema.extend({
	reason: z.string().trim().min(1, "reason is required for a manual membership"),
});

export const updateMembershipBodySchema = createMembershipBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const resumeMembershipBodySchema = z.object({
	resumedAt: z.string().trim().optional(),
	reason: z.string().trim().optional(),
});

export type CreateMembershipBody = z.infer<typeof createMembershipBodySchema>;
export type UpdateMembershipBody = z.infer<typeof updateMembershipBodySchema>;
export type ResumeMembershipBody = z.infer<typeof resumeMembershipBodySchema>;
