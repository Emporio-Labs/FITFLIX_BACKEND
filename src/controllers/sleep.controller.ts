import type { RequestHandler } from "express";
import {
	deleteSleepLog,
	getSleepSeries,
	logSleep,
} from "../services/sleep.service";
import {
	getSleepSeriesQuerySchema,
	logSleepSchema,
} from "../validators/sleep.validator";

export const logSleepHandler: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Access denied", code: "FORBIDDEN" });
		return;
	}

	const parsed = logSleepSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: parsed.error.issues.map((i) => ({
				field: i.path.map(String).join("."),
				message: i.message,
			})),
		});
		return;
	}

	try {
		const doc = await logSleep(req.user.id, parsed.data);
		res.status(200).json({
			success: true,
			message: "Sleep logged successfully",
			data: doc,
		});
	} catch (error) {
		next(error);
	}
};

export const getSleepSeriesHandler: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = getSleepSeriesQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: parsed.error.issues.map((i) => ({
				field: i.path.map(String).join("."),
				message: i.message,
			})),
		});
		return;
	}

	try {
		const targetUserId =
			(req.user.role === "admin" || req.user.role === "trainer") &&
			req.query.userId
				? String(req.query.userId)
				: req.user.id;

		const series = await getSleepSeries(
			targetUserId,
			parsed.data.from,
			parsed.data.to,
			parsed.data.days,
		);

		res.status(200).json({
			success: true,
			data: series,
		});
	} catch (error) {
		next(error);
	}
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string") return null;
	return idParam;
};

export const deleteSleepLogHandler: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const idParam = getIdParam(req.params.id);
	if (!idParam) {
		res.status(400).json({ error: "Missing or invalid log ID", code: "BAD_REQUEST" });
		return;
	}

	try {
		const deleted = await deleteSleepLog(req.user.id, idParam);
		if (!deleted) {
			res.status(404).json({ error: "Sleep log not found", code: "NOT_FOUND" });
			return;
		}
		res.status(200).json({ success: true, message: "Sleep log deleted" });
	} catch (error) {
		next(error);
	}
};
