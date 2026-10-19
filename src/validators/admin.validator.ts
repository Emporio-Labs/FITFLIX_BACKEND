import z from "zod";

// FX-32 — the staff roles an account can hold. null (omitted) = a full admin.
const staffRoleEnum = z.enum([
	"admin",
	"frontdesk",
	"manager",
	"sales",
	"trainer",
	"nutritionist",
	"sports_scientist",
]);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

// FX-32.1/32.2 — invite-based creation. No password: the backend creates the
// account in `invited` state and returns a one-time set-password link. Branches
// are chosen here for scoped roles; experts are marked `allBranches`.
export const inviteAdminBodySchema = z.object({
	adminName: z.string().min(1),
	email: z.email(),
	phone: z.string().min(1),
	staffRole: staffRoleEnum.nullish(),
	branchIds: z.array(objectId).optional(),
	allBranches: z.boolean().optional(),
});

// Edit — any subset of name/email/phone/role/branches. No password (that lives
// behind the set-password / reset flow).
export const updateAdminBodySchema = inviteAdminBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

// FX-32.3 — enable/disable an account.
export const setStatusBodySchema = z.object({
	status: z.enum(["active", "disabled"]),
});

// FX-32.4 — consume a one-time token and set the password. Mirrors the
// frontend's validatePassword (≥8 chars, at least one letter and one number).
export const setPasswordBodySchema = z.object({
	token: z.string().min(1),
	password: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.regex(/[A-Za-z]/, "Password must include at least one letter")
		.regex(/\d/, "Password must include at least one number"),
});

// Bootstrap-only — used by scripts/create-admin.ts to seed the first full admin
// directly (with a password), before any UI-invited account exists. The UI path
// uses inviteAdminBodySchema instead (no password).
export const createAdminBodySchema = z.object({
	adminName: z.string().min(1),
	email: z.email(),
	phone: z.string().min(1),
	password: z.string().min(6),
	staffRole: staffRoleEnum.nullish(),
});

export type InviteAdminBody = z.infer<typeof inviteAdminBodySchema>;
export type UpdateAdminBody = z.infer<typeof updateAdminBodySchema>;
export type SetStatusBody = z.infer<typeof setStatusBodySchema>;
export type SetPasswordBody = z.infer<typeof setPasswordBodySchema>;
