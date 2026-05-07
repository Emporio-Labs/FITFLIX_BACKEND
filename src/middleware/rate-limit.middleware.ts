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

export const createRateLimiter = (config: RateLimiterConfig): RequestHandler => {
	const buckets = new Map<string, RateLimitBucket>();

	return (req, res, next) => {
		const now = Date.now();
		cleanupExpiredBuckets(now, buckets);

		const key = `${config.keyPrefix}:${getClientIp(req)}`;
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
const AUTH_RATE_LIMIT_MAX = parseEnvNumber(
	process.env.AUTH_RATE_LIMIT_MAX,
	10,
	1,
);

export const authRateLimit = createRateLimiter({
	windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
	max: AUTH_RATE_LIMIT_MAX,
	keyPrefix: "auth",
	message: "Too many authentication attempts. Please try again later.",
});
