import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * A community-facing profile: the ONLY place a display name, bio or avatar is
 * stored for a person.
 *
 * Deliberately a separate collection rather than fields on `User`, because
 * `GET /users/me` and `GET /users/:id` return `user.toJSON()` — the entire
 * document, with no per-field privacy filter. Anything added to the User
 * schema would leak into every existing response.
 *
 * Keyed on `ownerId` ALONE, not (ownerId, ownerType). `createPost` snapshots
 * `authorRole` from the derived COMMUNITY role, so a User whose
 * `communityRole === "trainer"` writes posts tagged `authorRole: "trainer"`.
 * A compound key would then miss that person's profile on lookup. `ownerType`
 * is stored for provenance only and is never part of a read query.
 *
 * Documents are created LAZILY — nothing exists until the owner first edits
 * their profile or uploads an avatar. Reads synthesize defaults from the
 * underlying User/Trainer/Admin record. No migration, no backfill.
 */
const communityProfileSchema = new mongoose.Schema(
	{
		ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },

		/** Which collection `ownerId` points at. Provenance only. */
		ownerType: {
			type: String,
			enum: ["user", "trainer", "admin"],
			default: "user",
		},

		/** Optional override of username/trainerName/adminName. Empty = use it. */
		displayName: { type: String, default: "", maxlength: 40, trim: true },

		bio: { type: String, default: "", maxlength: 160, trim: true },

		/** S3 key (never a URL) for the 512x512 square avatar. */
		avatarKey: { type: String, default: "" },

		/** S3 key for the 128x128 square thumbnail used in feeds and lists. */
		avatarThumbKey: { type: String, default: "" },

		avatarUpdatedAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

communityProfileSchema.index({ ownerId: 1 }, { unique: true });

applyIdTransform(communityProfileSchema);

export default (mongoose.models
	.CommunityProfile as mongoose.Model<any>) ||
	mongoose.model("CommunityProfile", communityProfileSchema);
