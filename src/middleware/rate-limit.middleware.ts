import type { Request, RequestHandler } from "express";

type RateLimitBucket = {
	count: number;
	resetAt: number;
};

type RateLimiterConfig = {
	windowMs: number;
	max: number;
	keyPrefix: string;
	message: string;
	/**
	 * What to count requests against. Defaults to the client IP.
	 *
	 * IP is the wrong unit for authenticated, high-frequency routes: a gym's
	 * members all share one public IP behind NAT, so an IP budget is really a
	 * per-gym budget that the busiest floor exhausts first. Those routes pass
	 * [getAuthenticatedUserKey] instead.
	 */
	keyResolver?: (req: Request) => string;
};

const MAX_BUCKETS = 5000;

const parseEnvNumber = (
	value: string | undefined,
	fallback: number,
	min: number,
): number => {
	const parsed = Number(value);

	if (!Number.isFinite(parsed) || parsed < min) {
		return fallback;
	}

	return Math.floor(parsed);
};

const getClientIp = (req: Request): string => {
	const forwarded = req.header("x-forwarded-for");
	if (forwarded) {
		const ip = forwarded.split(",")[0]?.trim();
		if (ip) {
			return ip;
		}
	}

	if (req.ip) {
		return req.ip;
	}

	return req.socket.remoteAddress ?? "unknown";
};

/**
 * Counts against the authenticated user, falling back to IP when there is no
 * user on the request.
 *
 * The fallback should be unreachable wherever this is used — these limiters
 * mount after `authenticateToken` — but it must not silently collapse every
 * anonymous request into one shared bucket keyed `undefined`, which would let a
 * single caller lock out all others. Namespaced so a user id can never collide
 * with an IP.
 */
export const getAuthenticatedUserKey = (req: Request): string => {
	const userId = req.user?.id;
	return userId ? `u:${userId}` : `ip:${getClientIp(req)}`;
};

const cleanupExpiredBuckets = (
	now: number,
	buckets: Map<string, RateLimitBucket>,
) => {
	if (buckets.size <= MAX_BUCKETS) {
		return;
	}

	for (const [key, bucket] of buckets.entries()) {
		if (bucket.resetAt <= now) {
			buckets.delete(key);
		}
	}
};

export const createRateLimiter = (
	config: RateLimiterConfig,
): RequestHandler => {
	const buckets = new Map<string, RateLimitBucket>();
	const resolveKey = config.keyResolver ?? getClientIp;

	return (req, res, next) => {
		const now = Date.now();
		cleanupExpiredBuckets(now, buckets);

		const key = `${config.keyPrefix}:${resolveKey(req)}`;
		const existingBucket = buckets.get(key);

		const bucket =
			!existingBucket || existingBucket.resetAt <= now
				? { count: 0, resetAt: now + config.windowMs }
				: existingBucket;

		if (bucket.count >= config.max) {
			const secondsUntilReset = Math.max(
				1,
				Math.ceil((bucket.resetAt - now) / 1000),
			);

			res.setHeader("Retry-After", String(secondsUntilReset));
			res.setHeader("X-RateLimit-Limit", String(config.max));
			res.setHeader("X-RateLimit-Remaining", "0");
			res.setHeader(
				"X-RateLimit-Reset",
				String(Math.floor(bucket.resetAt / 1000)),
			);

			res.status(429).json({ message: config.message });
			return;
		}

		bucket.count += 1;
		buckets.set(key, bucket);

		res.setHeader("X-RateLimit-Limit", String(config.max));
		res.setHeader(
			"X-RateLimit-Remaining",
			String(Math.max(0, config.max - bucket.count)),
		);
		res.setHeader(
			"X-RateLimit-Reset",
			String(Math.floor(bucket.resetAt / 1000)),
		);

		next();
	};
};

const AUTH_RATE_LIMIT_WINDOW_MS = parseEnvNumber(
	process.env.AUTH_RATE_LIMIT_WINDOW_MS,
	15 * 60 * 1000,
	1000,
);
const defaultAuthMax = process.env.NODE_ENV === "development" ? 500 : 10;
const AUTH_RATE_LIMIT_MAX = parseEnvNumber(
	process.env.AUTH_RATE_LIMIT_MAX,
	defaultAuthMax,
	1,
);

export const authRateLimit = createRateLimiter({
	windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
	max: AUTH_RATE_LIMIT_MAX,
	keyPrefix: "auth",
	message: "Too many authentication attempts. Please try again later.",
});

// General API rate limiter for sensitive authenticated routes.
// 120 requests per minute per IP — generous enough for normal use,
// tight enough to blunt brute-force / scraping attempts.
const API_RATE_LIMIT_WINDOW_MS = parseEnvNumber(
	process.env.API_RATE_LIMIT_WINDOW_MS,
	60 * 1000, // 1 minute
	1000,
);
const API_RATE_LIMIT_MAX = parseEnvNumber(
	process.env.API_RATE_LIMIT_MAX,
	120,
	1,
);

export const apiRateLimit = createRateLimiter({
	windowMs: API_RATE_LIMIT_WINDOW_MS,
	max: API_RATE_LIMIT_MAX,
	keyPrefix: "api",
	message: "Too many requests. Please slow down and try again shortly.",
});

// Workout routes, keyed per user rather than per IP.
//
// This is the busiest authenticated surface in the product: the member app
// polls GET /workouts/active every 3 seconds for the whole of a live session
// (20 req/min), and each poll costs five sequential Mongo queries server-side.
// Layered on top of that are the bursts — seeding a plan day is one POST per
// exercise, and every set log triggers a session refetch.
//
// So the budget is sized to be invisible in normal use and only catch a client
// that has genuinely run away: ~25 req/min is a busy session, 240 leaves an
// order of magnitude of headroom while still capping a runaway loop at 4 req/s
// instead of letting it run unbounded.
//
// Per user, not per IP: at 20 req/min of polling alone, an IP-keyed budget of
// 120/min would start rejecting the seventh member on a shared gym wifi.
const WORKOUT_RATE_LIMIT_WINDOW_MS = parseEnvNumber(
	process.env.WORKOUT_RATE_LIMIT_WINDOW_MS,
	60 * 1000, // 1 minute
	1000,
);
const WORKOUT_RATE_LIMIT_MAX = parseEnvNumber(
	process.env.WORKOUT_RATE_LIMIT_MAX,
	240,
	1,
);

export const workoutRateLimit = createRateLimiter({
	windowMs: WORKOUT_RATE_LIMIT_WINDOW_MS,
	max: WORKOUT_RATE_LIMIT_MAX,
	keyPrefix: "workout",
	message: "Too many workout requests. Please slow down and try again shortly.",
	keyResolver: getAuthenticatedUserKey,
});
