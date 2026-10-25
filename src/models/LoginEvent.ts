import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * One successful email/password login — the audit trail behind the front
 * desk "Login Activity" report. Before this, logins only existed as masked
 * console lines in journald, with no name or branch, and rotated away.
 *
 * `name`, `email` and `role` are snapshotted at login time so the report
 * still reads correctly after an account is renamed or deleted.
 */
const loginEventSchema = new mongoose.Schema(
	{
		accountId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			index: true,
		},
		accountKind: {
			type: String,
			enum: ["user", "admin", "trainer"],
			required: true,
		},
		// Effective role in the issued token (staffRole wins for staff Users).
		role: { type: String, required: true },
		name: { type: String, default: "" },
		email: { type: String, default: "" },
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
		ip: { type: String, default: "" },
		userAgent: { type: String, default: "" },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

loginEventSchema.index({ createdAt: -1 });

applyIdTransform(loginEventSchema);

export default (mongoose.models.LoginEvent as mongoose.Model<any>) ||
	mongoose.model("LoginEvent", loginEventSchema);
