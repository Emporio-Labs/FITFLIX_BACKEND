import type { RequestHandler } from "express";
import mongoose from "mongoose";
import GymVisit, { VISIT_TYPES, type VisitType } from "../models/GymVisit";
import User from "../models/User";
import { getActiveMembership } from "../utils/membership.guard";
import { getJwtConfig, signGymQrToken, verifyGymQrToken } from "../utils/jwt";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const parseLimit = (raw: unknown, fallback = DEFAULT_LIMIT): number => {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(Math.floor(n), MAX_LIMIT);
};

const parseDate = (raw: unknown): Date | null => {
	if (typeof raw !== "string" || !raw) return null;
	const d = new Date(raw);
	return Number.isNaN(d.getTime()) ? null : d;
};

const isValidObjectId = (v: unknown): v is string =>
	typeof v === "string" && mongoose.Types.ObjectId.isValid(v);

const serializeVisit = (raw: any, user?: { username?: string; email?: string }) => ({
	id: String(raw._id ?? raw.id ?? ""),
	userId: String(raw.userId ?? ""),
	username: user?.username ?? raw.username ?? null,
	email: user?.email ?? raw.email ?? null,
	checkInAt: raw.checkInAt,
	checkOutAt: raw.checkOutAt ?? null,
	durationMinutes: raw.durationMinutes ?? null,
	visitType: raw.visitType,
	notes: raw.notes ?? null,
	checkedInByAdminId: raw.checkedInByAdminId
		? String(raw.checkedInByAdminId)
		: null,
	checkedOutByAdminId: raw.checkedOutByAdminId
		? String(raw.checkedOutByAdminId)
		: null,
	createdAt: raw.createdAt,
	updatedAt: raw.updatedAt,
});

type CheckInResult =
	| { ok: true; visit: any; user: { username?: string; email?: string } | null }
	| { ok: false; status: number; body: Record<string, unknown> };

/**
 * Shared by manual (search-and-select) and QR-scan check-in paths: validates
 * membership + dedup, then opens a GymVisit. Callers translate the result
 * into their own response shape.
 */
async function performCheckIn(
	userId: string,
	adminId: string | undefined,
	visitType: unknown,
	notes: unknown,
): Promise<CheckInResult> {
	const type: VisitType = VISIT_TYPES.includes(visitType as VisitType)
		? (visitType as VisitType)
		: "workout";

	const user = await User.findById(userId).select("username email").lean();
	if (!user) {
		return { ok: false, status: 404, body: { message: "Member not found" } };
	}

	// Block check-in if the member has no active, non-expired membership.
	const activeMembership = await getActiveMembership(userId);
	if (!activeMembership) {
		return {
			ok: false,
			status: 403,
			body: {
				message: "Member does not have an active membership",
				code: "NO_ACTIVE_MEMBERSHIP",
			},
		};
	}

	// Block check-in if the member is already checked in.
	const openVisit = await GymVisit.findOne({ userId, checkOutAt: null });
	if (openVisit) {
		return {
			ok: false,
			status: 409,
			body: { message: "Member is already checked in" },
		};
	}

	const visit = await GymVisit.create({
		userId: new mongoose.Types.ObjectId(userId),
		visitType: type,
		notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
		checkedInByAdminId: adminId ? new mongoose.Types.ObjectId(adminId) : null,
	});

	return { ok: true, visit: visit.toObject(), user: user as any };
}

/** Admin marks a member as present (opens a new visit). */
export const checkInMember: RequestHandler = async (req, res, next) => {
	try {
		const { userId, visitType, notes } = req.body ?? {};

		if (!isValidObjectId(userId)) {
			res.status(400).json({ message: "userId is required" });
			return;
		}

		const result = await performCheckIn(userId, req.user?.id, visitType, notes);
		if (!result.ok) {
			res.status(result.status).json(result.body);
			return;
		}

		res.status(201).json({
			message: "Member checked in",
			visit: serializeVisit(result.visit, result.user ?? undefined),
		});
	} catch (err) {
		next(err);
	}
};

/** Member fetches a short-lived rotating QR token to present at the front desk. */
export const issueQrToken: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}
	try {
		const activeMembership = await getActiveMembership(req.user.id);
		if (!activeMembership) {
			res.status(403).json({
				message: "Member does not have an active membership",
				code: "NO_ACTIVE_MEMBERSHIP",
			});
			return;
		}

		const config = getJwtConfig();
		if (!config) {
			res.status(500).json({ message: "Server auth misconfigured" });
			return;
		}

		const token = signGymQrToken(req.user.id, config);
		res.status(200).json({ token, expiresIn: 90 });
	} catch (err) {
		next(err);
	}
};

/** Front-desk scans a member's QR code to check them in. */
export const qrCheckIn: RequestHandler = async (req, res, next) => {
	try {
		const { token } = req.body ?? {};
		if (typeof token !== "string" || !token) {
			res.status(400).json({ message: "token is required" });
			return;
		}

		const config = getJwtConfig();
		if (!config) {
			res.status(500).json({ message: "Server auth misconfigured" });
			return;
		}

		const userId = verifyGymQrToken(token, config);
		if (!userId) {
			res.status(400).json({
				message: "Invalid or expired QR code",
				code: "INVALID_QR",
			});
			return;
		}

		const result = await performCheckIn(userId, req.user?.id, "workout", null);
		if (!result.ok) {
			res.status(result.status).json(result.body);
			return;
		}

		res.status(201).json({
			message: "Member checked in",
			visit: serializeVisit(result.visit, result.user ?? undefined),
		});
	} catch (err) {
		next(err);
	}
};

/** Admin closes an open visit; computes duration in minutes. */
export const checkOutVisit: RequestHandler = async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!isValidObjectId(id)) {
			res.status(400).json({ message: "Invalid visit id" });
			return;
		}

		const visit = await GymVisit.findById(id);
		if (!visit) {
			res.status(404).json({ message: "Visit not found" });
			return;
		}
		if (visit.checkOutAt) {
			res.status(409).json({ message: "Visit is already checked out" });
			return;
		}

		const now = new Date();
		visit.checkOutAt = now;
		visit.durationMinutes = Math.max(
			0,
			Math.round(
				(now.getTime() - new Date(visit.checkInAt as unknown as Date).getTime()) /
					60000,
			),
		);
		if (req.user?.id) {
			visit.checkedOutByAdminId = new mongoose.Types.ObjectId(req.user.id);
		}
		const { notes } = req.body ?? {};
		if (typeof notes === "string" && notes.trim()) {
			visit.notes = notes.trim();
		}
		await visit.save();

		res.status(200).json({
			message: "Member checked out",
			visit: serializeVisit(visit.toObject()),
		});
	} catch (err) {
		next(err);
	}
};

/** Admin — list visits with filters. */
export const listVisits: RequestHandler = async (req, res, next) => {
	try {
		const { userId, visitType, from, to, status } = req.query;
		const limit = parseLimit(req.query.limit);
		const offset = Math.max(0, Number(req.query.offset) || 0);

		const filter: Record<string, unknown> = {};
		if (isValidObjectId(userId)) {
			filter.userId = new mongoose.Types.ObjectId(userId);
		}
		if (typeof visitType === "string" && VISIT_TYPES.includes(visitType as VisitType)) {
			filter.visitType = visitType;
		}
		if (status === "open") filter.checkOutAt = null;
		if (status === "closed") filter.checkOutAt = { $ne: null };

		const fromDate = parseDate(from);
		const toDate = parseDate(to);
		if (fromDate || toDate) {
			filter.checkInAt = {
				...(fromDate ? { $gte: fromDate } : {}),
				...(toDate ? { $lte: toDate } : {}),
			};
		}

		const [items, total] = await Promise.all([
			GymVisit.find(filter)
				.sort({ checkInAt: -1 })
				.skip(offset)
				.limit(limit)
				.lean(),
			GymVisit.countDocuments(filter),
		]);

		const userIds = Array.from(
			new Set(items.map((it: any) => String(it.userId)).filter(isValidObjectId)),
		);
		const users = userIds.length
			? await User.find({ _id: { $in: userIds } })
					.select("username email")
					.lean()
			: [];
		const userById = new Map(users.map((u: any) => [String(u._id), u]));

		res.status(200).json({
			items: items.map((it: any) => serializeVisit(it, userById.get(String(it.userId)))),
			total,
			limit,
			offset,
		});
	} catch (err) {
		next(err);
	}
};

/** Members currently inside the gym (open visits), most-recent first. */
export const listCurrentlyIn: RequestHandler = async (_req, res, next) => {
	try {
		const items = await GymVisit.find({ checkOutAt: null })
			.sort({ checkInAt: -1 })
			.lean();

		const userIds = Array.from(
			new Set(items.map((it: any) => String(it.userId)).filter(isValidObjectId)),
		);
		const users = userIds.length
			? await User.find({ _id: { $in: userIds } })
					.select("username email")
					.lean()
			: [];
		const userById = new Map(users.map((u: any) => [String(u._id), u]));

		res.status(200).json({
			items: items.map((it: any) => serializeVisit(it, userById.get(String(it.userId)))),
		});
	} catch (err) {
		next(err);
	}
};

/** Admin analytics — visits/day, unique members/day, avg duration. */
export const getVisitAnalytics: RequestHandler = async (req, res, next) => {
	try {
		const { from, to } = req.query;

		const fromDate =
			parseDate(from) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const toDate = parseDate(to) ?? new Date();

		const match: Record<string, unknown> = {
			checkInAt: { $gte: fromDate, $lte: toDate },
		};

		const byDay = await GymVisit.aggregate([
			{ $match: match },
			{
				$group: {
					_id: {
						$dateToString: { format: "%Y-%m-%d", date: "$checkInAt" },
					},
					visits: { $sum: 1 },
					users: { $addToSet: "$userId" },
					durationSum: {
						$sum: { $ifNull: ["$durationMinutes", 0] },
					},
					durationCount: {
						$sum: {
							$cond: [{ $ne: ["$durationMinutes", null] }, 1, 0],
						},
					},
				},
			},
			{
				$project: {
					_id: 0,
					date: "$_id",
					visits: 1,
					uniqueUsers: { $size: "$users" },
					avgDurationMinutes: {
						$cond: [
							{ $gt: ["$durationCount", 0] },
							{ $divide: ["$durationSum", "$durationCount"] },
							null,
						],
					},
				},
			},
			{ $sort: { date: 1 } },
		]);

		const totals = byDay.reduce(
			(
				acc: { totalVisits: number; totalDuration: number; totalClosed: number },
				row: any,
			) => {
				acc.totalVisits += row.visits;
				if (row.avgDurationMinutes != null) {
					// weighted by day count is a rough proxy; a second pass could be more precise
				}
				return acc;
			},
			{ totalVisits: 0, totalDuration: 0, totalClosed: 0 },
		);

		const uniqueUsersAgg = await GymVisit.aggregate([
			{ $match: match },
			{ $group: { _id: "$userId" } },
			{ $count: "count" },
		]);
		const uniqueUsers = uniqueUsersAgg[0]?.count ?? 0;

		const durationAgg = await GymVisit.aggregate([
			{ $match: { ...match, durationMinutes: { $ne: null } } },
			{
				$group: {
					_id: null,
					avg: { $avg: "$durationMinutes" },
					count: { $sum: 1 },
				},
			},
		]);
		const avgDurationMinutes = durationAgg[0]?.avg ?? null;
		const closedVisits = durationAgg[0]?.count ?? 0;

		res.status(200).json({
			from: fromDate.toISOString(),
			to: toDate.toISOString(),
			totalVisits: totals.totalVisits,
			uniqueUsers,
			closedVisits,
			avgDurationMinutes,
			byDay,
		});
	} catch (err) {
		next(err);
	}
};

/** Current user's own gym visit history. */
export const getMyVisits: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}
	try {
		const limit = parseLimit(req.query.limit);
		const items = await GymVisit.find({ userId: req.user.id })
			.sort({ checkInAt: -1 })
			.limit(limit)
			.lean();

		res.status(200).json({
			items: items.map((it: any) => serializeVisit(it)),
		});
	} catch (err) {
		next(err);
	}
};
