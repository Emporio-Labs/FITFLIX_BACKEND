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
});

export const updateMembershipBodySchema = createMembershipBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateMembershipBody = z.infer<typeof createMembershipBodySchema>;
export type UpdateMembershipBody = z.infer<typeof updateMembershipBodySchema>;
