import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * Remote copy overrides for the mobile app.
 *
 * The app ships every string it needs as a hardcoded default and asks this
 * collection only whether to say something else. That direction matters: an
 * empty collection — or an unreachable server — is a normal, correct state in
 * which the app renders its baked-in copy. Nothing here is required for the
 * app to work; this exists so marketing copy can change without an App Store
 * and Play Store review cycle, which is the whole reason the surface exists.
 *
 * Keys are authored by the app, not here. A row whose `key` no key in the app
 * reads is harmless and simply ignored, so deleting app code never orphans
 * anything that breaks.
 *
 * `platform` lets one store copy diverge without forking the key. A null
 * platform is the default for every platform; an "ios"/"android" row overrides
 * the null one for that platform only, which is why the unique index is on the
 * pair rather than on `key` alone.
 */

export const CONTENT_PLATFORMS = ["ios", "android"] as const;

/**
 * Dotted, lowercase, namespaced by surface — `visitor.hero.title`,
 * `landing.cta.primary`. Enforced so the key space stays greppable from the
 * app side; a typo'd key silently falls back to the default, and a convention
 * is the only thing that makes that failure findable.
 */
const KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const contentOverrideSchema = new mongoose.Schema(
	{
		key: {
			type: String,
			required: true,
			trim: true,
			maxlength: 120,
			match: [
				KEY_PATTERN,
				"Key must be lowercase dotted segments, e.g. visitor.hero.title",
			],
		},
		value: { type: String, required: true, maxlength: 2000 },
		// Null means every platform.
		platform: {
			type: String,
			enum: [...CONTENT_PLATFORMS, null],
			default: null,
		},
		// For whoever opens the admin table in six months and finds a key with
		// no obvious home. Never sent to the app.
		note: { type: String, default: "", trim: true, maxlength: 500 },
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

// One row per key per platform. The null-platform row is the general case and
// coexists with a platform-specific override of the same key.
contentOverrideSchema.index({ key: 1, platform: 1 }, { unique: true });
// Serves the public read: every live row in one pass.
contentOverrideSchema.index({ isActive: 1 });

applyIdTransform(contentOverrideSchema);

type ContentOverrideDocument = mongoose.InferSchemaType<
	typeof contentOverrideSchema
>;

export default (mongoose.models
	.ContentOverride as mongoose.Model<ContentOverrideDocument>) ||
	mongoose.model<ContentOverrideDocument>(
		"ContentOverride",
		contentOverrideSchema,
	);
