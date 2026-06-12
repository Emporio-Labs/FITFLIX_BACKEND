import type { Request, RequestHandler } from "express";

type RateLimitBucket = {
	count: number;
	resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

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

const RATE_LIMIT_WINDOW_MS = parseEnvNumber(
	process.env.PUBLIC_LEAD_RATE_LIMIT_WINDOW_MS,
	10 * 60 * 1000,
	1000,
);
const RATE_LIMIT_MAX = parseEnvNumber(
	process.env.PUBLIC_LEAD_RATE_LIMIT_MAX,
	5,
	1,
);
const MAX_BUCKETS = 5000;

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

const cleanupExpiredBuckets = (now: number) => {
	if (buckets.size <= MAX_BUCKETS) {
		return;
	}

	for (const [key, bucket] of buckets.entries()) {
		if (bucket.resetAt <= now) {
			buckets.delete(key);
		}
	}
};

export const publicLeadCaptureRateLimit: RequestHandler = (req, res, next) => {
	const now = Date.now();
	cleanupExpiredBuckets(now);

	const key = getClientIp(req);
	const existingBucket = buckets.get(key);

	const bucket =
		!existingBucket || existingBucket.resetAt <= now
			? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
			: existingBucket;

	if (bucket.count >= RATE_LIMIT_MAX) {
		const secondsUntilReset = Math.max(
			1,
			Math.ceil((bucket.resetAt - now) / 1000),
		);

		res.setHeader("Retry-After", String(secondsUntilReset));
		res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
		res.setHeader("X-RateLimit-Remaining", "0");
		res.setHeader(
			"X-RateLimit-Reset",
			String(Math.floor(bucket.resetAt / 1000)),
		);

		res.status(429).json({
			message: "Too many lead submissions. Please try again later.",
		});
		return;
	}

	bucket.count += 1;
	buckets.set(key, bucket);

	res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
	res.setHeader(
		"X-RateLimit-Remaining",
		String(Math.max(0, RATE_LIMIT_MAX - bucket.count)),
	);
	res.setHeader("X-RateLimit-Reset", String(Math.floor(bucket.resetAt / 1000)));

	next();
};

const deleteBuckets = new Map<string, RateLimitBucket>();

export const publicDeleteAccountRateLimit: RequestHandler = (req, res, next) => {
	const now = Date.now();
	if (deleteBuckets.size > MAX_BUCKETS) {
		for (const [key, b] of deleteBuckets.entries()) {
			if (b.resetAt <= now) {
				deleteBuckets.delete(key);
			}
		}
	}

	const key = getClientIp(req);
	const existingBucket = deleteBuckets.get(key);

	const windowMs = 15 * 60 * 1000; // 15 minutes
	const maxRequests = 3;

	const bucket =
		!existingBucket || existingBucket.resetAt <= now
			? { count: 0, resetAt: now + windowMs }
			: existingBucket;

	if (bucket.count >= maxRequests) {
		const secondsUntilReset = Math.max(
			1,
			Math.ceil((bucket.resetAt - now) / 1000),
		);

		res.setHeader("Retry-After", String(secondsUntilReset));
		res.setHeader("X-RateLimit-Limit", String(maxRequests));
		res.setHeader("X-RateLimit-Remaining", "0");
		res.setHeader(
			"X-RateLimit-Reset",
			String(Math.floor(bucket.resetAt / 1000)),
		);

		res.status(429).json({
			error: "Too many deletion requests. Please try again later.",
			code: "TOO_MANY_REQUESTS",
		});
		return;
	}

	bucket.count += 1;
	deleteBuckets.set(key, bucket);

	res.setHeader("X-RateLimit-Limit", String(maxRequests));
	res.setHeader(
		"X-RateLimit-Remaining",
		String(Math.max(0, maxRequests - bucket.count)),
	);
	res.setHeader("X-RateLimit-Reset", String(Math.floor(bucket.resetAt / 1000)));

	next();
};
