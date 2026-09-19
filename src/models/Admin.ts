import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * A staff identity. Branch scope lives here rather than on the JWT alone, so
 * it survives a token refresh and can be changed without forcing a re-login.
 *
 * `isGlobal` is HQ / super-admin: every branch, no filtering. Otherwise the
 * admin sees only the branches listed in `locationIds`. An empty array with
 * `isGlobal: false` means the admin has not been assigned a branch yet and is
 * scoped to nothing — deliberately fail-closed.
 */
const adminSchema = new mongoose.Schema(
	{
		adminName: { type: String, required: true },
		email: { type: String, required: true, unique: true, sparse: true },
		phone: { type: String, required: true },
		passwordHash: { type: String, required: true, select: false },
		// Branches this admin manages. Ignored when isGlobal is true.
		locationIds: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Location",
			},
		],
		isGlobal: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

adminSchema.index({ locationIds: 1 });

applyIdTransform(adminSchema);

export default (mongoose.models.Admin as mongoose.Model<any>) ||
	mongoose.model("Admin", adminSchema);
