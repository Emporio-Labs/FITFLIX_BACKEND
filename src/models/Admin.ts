import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

const adminSchema = new mongoose.Schema(
	{
		adminName: { type: String, required: true },
		email: { type: String, required: true, unique: true, sparse: true },
		phone: { type: String, required: true },
		// FX-32 — no longer required: an invited account is created WITHOUT a
		// password and sets its own via the one-time set-password link. The hash
		// lands here only once the person completes that flow.
		passwordHash: { type: String, required: false, select: false },
		// FX-31/FX-32 — the workspace an admin-family account lands in. Every Admin
		// is still "admin" at the API-authorization layer (login issues role
		// "admin"); this sub-role is surfaced as a signed JWT claim + login-response
		// field so the staff web app can route the account to a scoped console.
		// FX-32 unifies ALL staff logins here, so the enum now spans the expert
		// roles too. null = a full admin, who gets the complete dashboard.
		staffRole: {
			type: String,
			enum: [
				"admin",
				"frontdesk",
				"manager",
				"sales",
				"trainer",
				"nutritionist",
				"sports_scientist",
				null,
			],
			default: null,
			index: true,
		},
		// FX-32.1 — branches this account works at. Empty + allBranches=false means
		// "no branch yet" (a scoped role still awaiting allocation). Experts are
		// marked allBranches=true and ignore branchIds. Full admins (staffRole
		// admin/null) are global and ignore both.
		branchIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
		allBranches: { type: Boolean, default: false },
		// FX-32.3 — account lifecycle. `invited` = created but no password set yet;
		// `active` = password set / has signed in; `disabled` = refused on next
		// action and can no longer sign in. staffContext.service re-derives
		// `disabled` from this on every request.
		status: {
			type: String,
			enum: ["invited", "active", "disabled"],
			default: "active",
			index: true,
		},
		// FX-32 — tells who has actually migrated / signed in (also shown in the UI).
		lastLoginAt: { type: Date },
		// FX-32.4 — one-time set-password / reset token. Only the sha256 hash is
		// stored; the raw token travels in the invite link. select:false so it never
		// leaks through the default toJSON serialization.
		inviteTokenHash: { type: String, select: false },
		inviteTokenExpiresAt: { type: Date, select: false },
	},
	{ timestamps: true },
);

applyIdTransform(adminSchema);

export default (mongoose.models.Admin as mongoose.Model<any>) ||
	mongoose.model("Admin", adminSchema);
