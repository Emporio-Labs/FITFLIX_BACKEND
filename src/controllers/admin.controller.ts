import crypto from "node:crypto";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Admin from "../models/Admin";
import { hashPassword } from "../utils/password";
import { isEmailInUseAcrossSystem } from "../utils/email-uniqueness";
import { clearStaffContextCache } from "../services/staffContext.service";
import {
	inviteAdminBodySchema,
	setPasswordBodySchema,
	setStatusBodySchema,
	updateAdminBodySchema,
} from "../validators/admin.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

// FX-32 — the invite link base. There is no mailer in this repo, so the invite
// endpoints return the link in the response body and the web app surfaces a
// copyable fallback (see admin.service.ts). Override with WEB_APP_URL in prod.
const WEB_APP_URL = (process.env.WEB_APP_URL || "http://localhost:3001").replace(
	/\/$/,
	"",
);
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// FX-32.1 — expert consoles work across every branch; they ignore branchIds.
const EXPERT_ROLES = new Set(["trainer", "nutritionist", "sports_scientist"]);
// Full admins are global and ignore branch selection entirely.
const isFullAdmin = (staffRole: string | null | undefined): boolean =>
	staffRole == null || staffRole === "admin";

const hashToken = (raw: string): string =>
	crypto.createHash("sha256").update(raw).digest("hex");

const buildInviteLink = (rawToken: string): string =>
	`${WEB_APP_URL}/set-password?token=${encodeURIComponent(rawToken)}`;

/**
 * FX-32.5 — number of full admins who can still sign in. A full admin is one
 * with staffRole "admin" or null (the complete dashboard); a disabled account
 * does not count. Used to refuse disabling, demoting or deleting the last one.
 */
const countActiveFullAdmins = (): Promise<number> =>
	Admin.countDocuments({
		status: { $ne: "disabled" },
		$or: [{ staffRole: "admin" }, { staffRole: null }],
	});

/**
 * Normalise the branch selection for a role and validate it. Experts are forced
 * to allBranches; full admins ignore branches; other scoped roles must name at
 * least one branch (unless explicitly allBranches). Returns an error message
 * when the selection is invalid, or the sanitised fields to persist.
 */
const resolveBranchFields = (
	staffRole: string | null | undefined,
	branchIds: string[] | undefined,
	allBranches: boolean | undefined,
): { error: string } | { branchIds: string[]; allBranches: boolean } => {
	if (isFullAdmin(staffRole)) {
		return { branchIds: [], allBranches: false };
	}
	if (EXPERT_ROLES.has(staffRole as string)) {
		return { branchIds: [], allBranches: true };
	}
	// frontdesk / manager / sales — branch-scoped.
	if (allBranches) {
		return { branchIds: [], allBranches: true };
	}
	const ids = Array.isArray(branchIds) ? branchIds : [];
	if (ids.length === 0) {
		return {
			error: "Select at least one branch for this role, or mark it all-branches.",
		};
	}
	return { branchIds: ids, allBranches: false };
};

export const createAdmin: RequestHandler = async (req, res, next) => {
	const parsedBody = inviteAdminBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid admin payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { adminName, email, phone, staffRole, branchIds, allBranches } =
		parsedBody.data;

	const branches = resolveBranchFields(staffRole, branchIds, allBranches);
	if ("error" in branches) {
		res.status(400).json({ message: branches.error });
		return;
	}

	try {
		const emailCheck = await isEmailInUseAcrossSystem(email);
		if (emailCheck.exists) {
			res.status(409).json({
				message: `An account with this email already exists as a ${emailCheck.accountType}`,
			});
			return;
		}

		// FX-32.1/32.2 — invited account: no password yet, a one-time token instead.
		const rawToken = crypto.randomBytes(32).toString("hex");

		const admin = await Admin.create({
			adminName,
			email,
			phone,
			staffRole: staffRole ?? null,
			branchIds: branches.branchIds,
			allBranches: branches.allBranches,
			status: "invited",
			inviteTokenHash: hashToken(rawToken),
			inviteTokenExpiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
		});

		res.status(201).json({
			message: "Invite created",
			admin,
			inviteLink: buildInviteLink(rawToken),
		});
	} catch (error) {
		next(error);
	}
};

export const getAllAdmins: RequestHandler = async (_req, res, next) => {
	try {
		// FX-32.6 — accounts still waiting for a role (invited, or no staffRole)
		// surface first so they are not forgotten. The web app sorts too, but
		// serving them first keeps any non-UI consumer consistent.
		const admins = await Admin.find().sort({ status: 1, staffRole: 1, createdAt: -1 });
		res.status(200).json({ admins });
	} catch (error) {
		next(error);
	}
};

export const getAdminById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	try {
		const admin = await Admin.findById(id);

		if (!admin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		res.status(200).json({ admin });
	} catch (error) {
		next(error);
	}
};

export const updateAdminById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	const parsedBody = updateAdminBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid admin update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const existing = await Admin.findById(id);
		if (!existing) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		const { staffRole, branchIds, allBranches, ...rest } = parsedBody.data;

		// Resolve the role we are landing on so branch validation matches it.
		const nextRole =
			staffRole !== undefined ? (staffRole ?? null) : existing.staffRole;

		// FX-32.5 — refuse demoting the last full admin away from a full-admin role.
		const roleChanges = staffRole !== undefined && nextRole !== existing.staffRole;
		if (roleChanges && isFullAdmin(existing.staffRole) && !isFullAdmin(nextRole)) {
			if ((await countActiveFullAdmins()) <= 1) {
				res.status(409).json({
					message: "Can't demote the last remaining admin. Assign another admin first.",
				});
				return;
			}
		}

		if (rest.email) {
			const emailCheck = await isEmailInUseAcrossSystem(rest.email, id);
			if (emailCheck.exists) {
				res.status(409).json({
					message: `An account with this email already exists as a ${emailCheck.accountType}`,
				});
				return;
			}
		}

		Object.assign(existing, rest);

		// Only touch branch fields when role or branches were part of the request;
		// otherwise an edit of just the name would wipe an account's branches.
		if (staffRole !== undefined || branchIds !== undefined || allBranches !== undefined) {
			const branches = resolveBranchFields(
				nextRole,
				branchIds !== undefined ? branchIds : existing.branchIds.map(String),
				allBranches !== undefined ? allBranches : existing.allBranches,
			);
			if ("error" in branches) {
				res.status(400).json({ message: branches.error });
				return;
			}
			existing.staffRole = nextRole;
			existing.branchIds = branches.branchIds as unknown as typeof existing.branchIds;
			existing.allBranches = branches.allBranches;
		}

		await existing.save();

		// FX-32.2 — role/branch change must take effect within a minute. Dropping
		// the cached staff context makes it immediate rather than waiting the TTL.
		clearStaffContextCache(id);

		res.status(200).json({ message: "Admin updated", admin: existing });
	} catch (error) {
		next(error);
	}
};

export const setAdminStatus: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	const parsedBody = setStatusBodySchema.safeParse(req.body);
	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid status payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { status } = parsedBody.data;

	try {
		const admin = await Admin.findById(id);
		if (!admin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		// FX-32.5 — never disable the last full admin.
		if (
			status === "disabled" &&
			admin.status !== "disabled" &&
			isFullAdmin(admin.staffRole) &&
			(await countActiveFullAdmins()) <= 1
		) {
			res.status(409).json({
				message: "Can't disable the last remaining admin. Assign another admin first.",
			});
			return;
		}

		admin.status = status;
		await admin.save();

		// FX-32.3 — refuse the account on its next action immediately.
		clearStaffContextCache(id);

		res.status(200).json({ message: `Account ${status}`, admin });
	} catch (error) {
		next(error);
	}
};

// FX-32.4 — (re)issue a one-time set-password link. Serves both the first-invite
// resend and a password reset for an already-active account.
export const resendInvite: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	try {
		const admin = await Admin.findById(id);
		if (!admin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		const rawToken = crypto.randomBytes(32).toString("hex");
		admin.inviteTokenHash = hashToken(rawToken);
		admin.inviteTokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);
		await admin.save();

		res.status(200).json({
			message: admin.status === "invited" ? "Invite link resent" : "Reset link created",
			inviteLink: buildInviteLink(rawToken),
		});
	} catch (error) {
		next(error);
	}
};

export const deleteAdminById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	try {
		const admin = await Admin.findById(id);
		if (!admin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		// FX-32.5 — deleting the last full admin would lock everyone out.
		if (isFullAdmin(admin.staffRole) && (await countActiveFullAdmins()) <= 1) {
			res.status(409).json({
				message: "Can't delete the last remaining admin. Assign another admin first.",
			});
			return;
		}

		await admin.deleteOne();
		clearStaffContextCache(id);

		res.status(200).json({ message: "Admin deleted" });
	} catch (error) {
		next(error);
	}
};

// ── Public set-password / invite-verification flow (FX-32.4) ──────────────────
// Mounted on the auth router (no auth guard): the person is not signed in yet.

export const verifyInvite: RequestHandler = async (req, res, next) => {
	const rawToken =
		typeof req.params.token === "string" ? req.params.token.trim() : "";

	if (!rawToken) {
		res.status(200).json({ valid: false, message: "Missing token" });
		return;
	}

	try {
		const admin = await Admin.findOne({ inviteTokenHash: hashToken(rawToken) })
			.select("+inviteTokenHash +inviteTokenExpiresAt adminName email")
			.lean<{
				adminName?: string;
				email?: string;
				inviteTokenExpiresAt?: Date;
			} | null>();

		if (!admin || !admin.inviteTokenExpiresAt || admin.inviteTokenExpiresAt.getTime() < Date.now()) {
			res.status(200).json({
				valid: false,
				message: "This link is invalid or has expired.",
			});
			return;
		}

		res.status(200).json({
			valid: true,
			email: admin.email,
			name: admin.adminName,
			expiresAt: admin.inviteTokenExpiresAt,
		});
	} catch (error) {
		next(error);
	}
};

export const setPassword: RequestHandler = async (req, res, next) => {
	const parsedBody = setPasswordBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid password payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { token, password } = parsedBody.data;

	try {
		const admin = await Admin.findOne({ inviteTokenHash: hashToken(token) }).select(
			"+inviteTokenHash +inviteTokenExpiresAt",
		);

		if (
			!admin ||
			!admin.inviteTokenExpiresAt ||
			admin.inviteTokenExpiresAt.getTime() < Date.now()
		) {
			res.status(400).json({ message: "This link is invalid or has expired." });
			return;
		}

		admin.passwordHash = await hashPassword(password);
		// A disabled account that resets its password must stay disabled; only an
		// invited/active account becomes active.
		if (admin.status !== "disabled") {
			admin.status = "active";
		}
		admin.inviteTokenHash = undefined;
		admin.inviteTokenExpiresAt = undefined;
		await admin.save();

		clearStaffContextCache(admin._id.toString());

		res.status(200).json({ message: "Password set successfully" });
	} catch (error) {
		next(error);
	}
};
