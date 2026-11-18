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
import { assertTrainerOwnsMember } from "../services/trainerRoster.service";
import { assertNutritionistOwnsMember } from "../services/nutritionistRoster.service";

class SleepAccessError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "SleepAccessError";
	}
}

/**
 * Sleep is health data (DPDP Act): staff only see members on their own
 * roster. Admins keep access; members only ever see their own logs.
 */
const assertCanReadMemberSleep = async (
	requester: { id: string; role: string },
	memberId: string,
): Promise<void> => {
	if (requester.role === "admin") return;

	if (requester.role === "user") {
		if (memberId === requester.id) return;
		throw new SleepAccessError(403, "FORBIDDEN", "You can only view your own sleep");
	}

	if (requester.role === "trainer") {
		await assertTrainerOwnsMember(requester.id, memberId);
		return;
	}

	if (requester.role === "nutritionist") {
		await assertNutritionistOwnsMember(requester.id, memberId);
		return;
	}

	throw new SleepAccessError(
		403,
		"FORBIDDEN",
		"You do not have permission to view this member's sleep",
	);
};

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
		const targetUserId = parsed.data.userId ?? req.user.id;
		await assertCanReadMemberSleep(req.user, targetUserId);

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
	} catch (error: any) {
		if (error instanceof SleepAccessError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		if (
			error?.name === "TrainerRosterError" ||
			error?.name === "NutritionistRosterError"
		) {
			if (error.code === "INVALID_ARGUMENT") {
				res.status(400).json({ error: error.message, code: "VALIDATION_ERROR" });
				return;
			}
			res.status(403).json({ error: error.message, code: "NOT_YOUR_MEMBER" });
			return;
		}
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
