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

	/** Per-audio byte ceiling (also enforced by multer). */
	maxAudioBytes: positiveInt(
		process.env.COMMUNITY_MAX_AUDIO_BYTES,
		20 * 1024 * 1024,
	),

	/** Per-clip duration ceiling in seconds. Enforced against a client-declared
	 * value on upload; the server treats the value as untrusted. */
	maxAudioDurationSeconds: positiveInt(
		process.env.COMMUNITY_MAX_AUDIO_DURATION_SECONDS,
		180,
	),

	/** Max audio clips attachable to a single post. */
	maxAudioPerPost: positiveInt(process.env.COMMUNITY_MAX_AUDIO_PER_POST, 1),

	/** Per-video byte ceiling. Enforced both at presign time (declared size)
	 * and again via a HEAD check against the actual uploaded object. */
	maxVideoBytes: positiveInt(
		process.env.COMMUNITY_MAX_VIDEO_BYTES,
		200 * 1024 * 1024,
	),

	/** How long a presigned video-upload PUT URL stays valid. */
	videoPresignedUrlTtlSeconds: positiveInt(
		process.env.COMMUNITY_VIDEO_PRESIGN_TTL_SECONDS,
		3600,
	),

	/** Max video clips attachable to a single post. */
	maxVideoPerPost: positiveInt(process.env.COMMUNITY_MAX_VIDEO_PER_POST, 1),

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
		/** Max chars of `description` returned in feed responses. Remainder is
		 *  signalled by `descriptionHasMore: true`; full text is on the detail
		 *  endpoint only. */
		descriptionPreviewLength: positiveInt(
			process.env.COMMUNITY_FEED_DESCRIPTION_PREVIEW_LENGTH,
			300,
		),
	},

	/** Server-generated image variant widths (px). Height scales proportionally. */
	imageVariants: {
		thumbnail: positiveInt(process.env.COMMUNITY_IMAGE_THUMBNAIL_WIDTH, 320),
		feed: positiveInt(process.env.COMMUNITY_IMAGE_FEED_WIDTH, 1080),
		// "full" = original dimensions, re-encoded.
	},

	/** Avatar variant edge lengths (px). Avatars are square centre-crops, so
	 *  these are both width and height. */
	avatarVariants: {
		full: positiveInt(process.env.COMMUNITY_AVATAR_FULL_PX, 512),
		thumb: positiveInt(process.env.COMMUNITY_AVATAR_THUMB_PX, 128),
	},

	profile: {
		maxDisplayNameLength: positiveInt(
			process.env.COMMUNITY_PROFILE_MAX_DISPLAY_NAME,
			40,
		),
		maxBioLength: positiveInt(process.env.COMMUNITY_PROFILE_MAX_BIO, 160),
		/** Max trainers prepended to page one of a people search. */
		searchTrainerLead: positiveInt(
			process.env.COMMUNITY_PEOPLE_SEARCH_TRAINER_LEAD,
			5,
		),
	},
} as const;
