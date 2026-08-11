import type { RequestHandler } from "express";
import Comment from "../models/Comment";
import Like from "../models/Like";
import Membership from "../models/Membership";
import Post from "../models/Post";
import { PostStatus } from "../models/Enums";
import Report from "../models/Report";
import Share from "../models/Share";
import User from "../models/User";

const BAD_RANGE = {
	error: "Invalid range. Allowed: today, 7d, 30d, 90d",
	code: "BAD_REQUEST",
};

/** In-process TTL cache keyed by (endpoint, range). Refreshed every 5 minutes. */
type CacheEntry = { at: number; payload: unknown };
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const cached = async (key: string, load: () => Promise<unknown>) => {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
		return hit.payload;
	}
	const payload = await load();
	cache.set(key, { at: Date.now(), payload });
	return payload;
};

const rangeStart = (range: string): Date | null => {
	const now = new Date();
	switch (range) {
		case "today": {
			const d = new Date(now);
			d.setHours(0, 0, 0, 0);
			return d;
		}
		case "7d":
			return new Date(now.getTime() - 7 * 86400 * 1000);
		case "30d":
			return new Date(now.getTime() - 30 * 86400 * 1000);
		case "90d":
			return new Date(now.getTime() - 90 * 86400 * 1000);
		default:
			return null;
	}
};

const readRange = (req: Parameters<RequestHandler>[0]): string =>
	typeof req.query.range === "string" ? req.query.range : "7d";

/** Group a stream of dated documents into per-day buckets from `from` to now. */
const bucketize = (
	docs: { createdAt: Date }[],
	from: Date,
): { date: string; count: number }[] => {
	const buckets = new Map<string, number>();
	// Seed every day in the range so gaps render as 0.
	const start = new Date(from);
	start.setHours(0, 0, 0, 0);
	const end = new Date();
	end.setHours(0, 0, 0, 0);
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		buckets.set(d.toISOString().slice(0, 10), 0);
	}
	for (const doc of docs) {
		const key = new Date(doc.createdAt).toISOString().slice(0, 10);
		buckets.set(key, (buckets.get(key) ?? 0) + 1);
	}
	return Array.from(buckets.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, count]) => ({ date, count }));
};

export const activeUsersMetricsHandler: RequestHandler = async (req, res, next) => {
	try {
		const range = readRange(req);
		const from = rangeStart(range);
		if (!from) {
			res.status(400).json(BAD_RANGE);
			return;
		}

		const payload = await cached(`active-users:${range}`, async () => {
			const dau = await User.countDocuments({
				updatedAt: {
					$gte: new Date(new Date().setHours(0, 0, 0, 0)),
				},
			});
			const wau = await User.countDocuments({
				updatedAt: { $gte: new Date(Date.now() - 7 * 86400 * 1000) },
			});
			const mau = await User.countDocuments({
				updatedAt: { $gte: new Date(Date.now() - 30 * 86400 * 1000) },
			});
			return { range, dau, wau, mau };
		});

		res.status(200).json(payload);
	} catch (error) {
		next(error);
	}
};

export const postsMetricsHandler: RequestHandler = async (req, res, next) => {
	try {
		const range = readRange(req);
		const from = rangeStart(range);
		if (!from) {
			res.status(400).json(BAD_RANGE);
			return;
		}

		const payload = await cached(`posts:${range}`, async () => {
			const posts = await Post.find({
				createdAt: { $gte: from },
				deletedAt: null,
				status: PostStatus.Published,
			})
				.select("createdAt visibility")
				.lean<{ createdAt: Date; visibility: string }[]>();

			const timeseries = bucketize(posts, from);
			const byVisibility: Record<string, number> = {};
			for (const p of posts) {
				byVisibility[p.visibility] = (byVisibility[p.visibility] ?? 0) + 1;
			}

			return { range, total: posts.length, timeseries, byVisibility };
		});

		res.status(200).json(payload);
	} catch (error) {
		next(error);
	}
};

export const engagementMetricsHandler: RequestHandler = async (req, res, next) => {
	try {
		const range = readRange(req);
		const from = rangeStart(range);
		if (!from) {
			res.status(400).json(BAD_RANGE);
			return;
		}

		const payload = await cached(`engagement:${range}`, async () => {
			const [likes, comments, shares] = await Promise.all([
				Like.find({ createdAt: { $gte: from } })
					.select("createdAt")
					.lean<{ createdAt: Date }[]>(),
				Comment.find({ createdAt: { $gte: from }, deletedAt: null })
					.select("createdAt")
					.lean<{ createdAt: Date }[]>(),
				Share.find({ createdAt: { $gte: from } })
					.select("createdAt")
					.lean<{ createdAt: Date }[]>(),
			]);

			return {
				range,
				totals: {
					likes: likes.length,
					comments: comments.length,
					shares: shares.length,
				},
				timeseries: {
					likes: bucketize(likes, from),
					comments: bucketize(comments, from),
					shares: bucketize(shares, from),
				},
			};
		});

		res.status(200).json(payload);
	} catch (error) {
		next(error);
	}
};

export const reportsMetricsHandler: RequestHandler = async (req, res, next) => {
	try {
		const range = readRange(req);
		const from = rangeStart(range);
		if (!from) {
			res.status(400).json(BAD_RANGE);
			return;
		}

		const payload = await cached(`reports:${range}`, async () => {
			const reports = await Report.find({ createdAt: { $gte: from } })
				.select("createdAt status")
				.lean<{ createdAt: Date; status?: string }[]>();
			const byStatus: Record<string, number> = {};
			for (const r of reports) {
				const k = r.status ?? "unknown";
				byStatus[k] = (byStatus[k] ?? 0) + 1;
			}
			return {
				range,
				total: reports.length,
				timeseries: bucketize(reports, from),
				byStatus,
			};
		});

		res.status(200).json(payload);
	} catch (error) {
		next(error);
	}
};

export const growthMetricsHandler: RequestHandler = async (req, res, next) => {
	try {
		const range = readRange(req);
		const from = rangeStart(range);
		if (!from) {
			res.status(400).json(BAD_RANGE);
			return;
		}

		const payload = await cached(`growth:${range}`, async () => {
			const [signups, memberships] = await Promise.all([
				User.find({ createdAt: { $gte: from } })
					.select("createdAt")
					.lean<{ createdAt: Date }[]>(),
				Membership.find({ createdAt: { $gte: from } })
					.select("createdAt")
					.lean<{ createdAt: Date }[]>(),
			]);

			return {
				range,
				totals: {
					newSignups: signups.length,
					newMemberships: memberships.length,
				},
				timeseries: {
					signups: bucketize(signups, from),
					memberships: bucketize(memberships, from),
				},
			};
		});

		res.status(200).json(payload);
	} catch (error) {
		next(error);
	}
};
