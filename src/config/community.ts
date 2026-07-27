/**
 * Community module configuration. Every tunable lives here (not hardcoded at
 * the call site) and can be overridden by an environment variable.
 */

const positiveInt = (value: string | undefined, fallback: number): number => {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const communityConfig = {
	/** How long after soft-delete a post may still be restored. */
	restoreWindowDays: positiveInt(process.env.COMMUNITY_RESTORE_WINDOW_DAYS, 30),

	/** Per-image byte ceiling (also enforced by multer). */
	maxImageBytes: positiveInt(
		process.env.COMMUNITY_MAX_IMAGE_BYTES,
		10 * 1024 * 1024,
	),

	/** Max images attachable to a single post. */
	maxImagesPerPost: positiveInt(process.env.COMMUNITY_MAX_IMAGES_PER_POST, 10),

	/** Base URL used to build the canonical public share link for a post. */
	publicBaseUrl: (
		process.env.COMMUNITY_PUBLIC_BASE_URL || "https://fitflix.in"
	).replace(/\/+$/, ""),

	feed: {
		defaultPageSize: positiveInt(
			process.env.COMMUNITY_FEED_DEFAULT_PAGE_SIZE,
			20,
		),
		maxPageSize: positiveInt(process.env.COMMUNITY_FEED_MAX_PAGE_SIZE, 50),
	},

	/** Server-generated image variant widths (px). Height scales proportionally. */
	imageVariants: {
		thumbnail: positiveInt(process.env.COMMUNITY_IMAGE_THUMBNAIL_WIDTH, 320),
		feed: positiveInt(process.env.COMMUNITY_IMAGE_FEED_WIDTH, 1080),
		// "full" = original dimensions, re-encoded.
	},
} as const;
