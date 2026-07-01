import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// AppSettings — global singleton configuration document
//
// The document is identified by the well-known key "global".
// Use AppSettings.getGlobal() to fetch (or lazily create) the singleton.
// ---------------------------------------------------------------------------

const appSettingsSchema = new mongoose.Schema(
	{
		/** Discriminator key — always "global" for the singleton document. */
		key: {
			type: String,
			required: true,
			unique: true,
			default: "global",
			immutable: true,
		},

		/**
		 * How many hours before a class start time the booking window opens.
		 * Default: 72 (i.e. 3 days).
		 */
		bookingWindowOpenHours: {
			type: Number,
			required: true,
			min: 1,
			default: 72,
		},
	},
	{ timestamps: true },
);

export type AppSettingsDocument = mongoose.InferSchemaType<
	typeof appSettingsSchema
>;

// ---------------------------------------------------------------------------
// In-memory cache — avoids a DB round-trip on every booking request.
// The cached value is evicted after CACHE_TTL_MS milliseconds so that admin
// changes to bookingWindowOpenHours propagate within one minute.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60 seconds

let _cachedSettings: AppSettingsDocument | null = null;
let _cacheExpiresAt = 0;

const AppSettingsModel =
	(mongoose.models.AppSettings as mongoose.Model<AppSettingsDocument>) ||
	mongoose.model<AppSettingsDocument>("AppSettings", appSettingsSchema);

/**
 * Returns the global AppSettings singleton.
 *
 * - On the first call (or after the cache TTL expires) it performs a
 *   `findOneAndUpdate` with `upsert: true` so that the document is created
 *   automatically on first boot with sensible defaults.
 * - Subsequent calls within the TTL window return the in-memory cached value.
 */
async function getGlobal(): Promise<AppSettingsDocument> {
	const now = Date.now();

	if (_cachedSettings && now < _cacheExpiresAt) {
		return _cachedSettings;
	}

	const doc = await AppSettingsModel.findOneAndUpdate(
		{ key: "global" },
		{ $setOnInsert: { key: "global", bookingWindowOpenHours: 72 } },
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	);

	if (!doc) {
		// Extremely unlikely — upsert always returns a document.
		throw new Error("Failed to fetch or create AppSettings singleton");
	}

	_cachedSettings = doc.toObject() as AppSettingsDocument;
	_cacheExpiresAt = now + CACHE_TTL_MS;

	return _cachedSettings;
}

/** Invalidate the in-memory cache (useful in tests or after admin updates). */
function invalidateCache(): void {
	_cachedSettings = null;
	_cacheExpiresAt = 0;
}

export const AppSettings = Object.assign(AppSettingsModel, {
	getGlobal,
	invalidateCache,
});

export default AppSettings;
