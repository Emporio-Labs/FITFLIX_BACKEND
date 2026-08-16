import { CONTENT_PLATFORMS } from "../models/ContentOverride";

export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

/**
 * The shape the resolver needs; the full document has more.
 *
 * `platform` admits undefined as well as null because that is what the
 * hydrated Mongoose document's type says: the field is optional, and a row
 * written before it existed would carry no value at all. Both mean the same
 * thing here — the general, every-platform row.
 */
export type ContentRow = {
	key: string;
	value: string;
	platform?: ContentPlatform | null;
};

/**
 * Which rows the public read is allowed to see.
 *
 * Inactive rows are never served. When no platform is asked for, only the
 * general (null-platform) rows come back — an iOS-only string must not leak
 * into a caller that didn't say it was iOS, because the caller would then
 * apply it everywhere.
 */
export const buildContentFilter = (opts: {
	platform?: ContentPlatform | null;
}): Record<string, unknown> => ({
	isActive: true,
	platform: opts.platform ? { $in: [null, opts.platform] } : null,
});

/**
 * Collapse rows into the flat `{ key: value }` map the app consumes.
 *
 * Precedence is the whole point: a platform-specific row wins over the general
 * row for the same key. That cannot be expressed in the query, because both
 * rows legitimately match — so the ordering is resolved here, in one place,
 * rather than depending on the order Mongo happens to return documents in.
 */
export const resolveContentMap = (
	rows: readonly ContentRow[],
): Record<string, string> => {
	const content: Record<string, string> = {};
	// Loose equality on purpose: an absent platform and an explicit null are
	// both the general row.
	for (const row of rows) {
		if (row.platform == null) content[row.key] = row.value;
	}
	for (const row of rows) {
		if (row.platform != null) content[row.key] = row.value;
	}
	return content;
};

export const isContentPlatform = (value: unknown): value is ContentPlatform =>
	typeof value === "string" &&
	(CONTENT_PLATFORMS as readonly string[]).includes(value);
