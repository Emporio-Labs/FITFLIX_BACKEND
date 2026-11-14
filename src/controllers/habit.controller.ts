import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	createCustomHabit,
	getCuratedCatalog,
	getMyHabits,
	getTodayHabits,
	toggleHabit,
	updateHabit,
} from "../services/habit.service";
import {
	createHabitSchema,
	toggleHabitSchema,
	updateHabitSchema,
} from "../validators/habit.validator";

export const getTodayHabitsHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const dateQuery =
			typeof req.query.date === "string" ? req.query.date : undefined;
		const data = await getTodayHabits(userId, dateQuery);

		res.status(200).json({
			success: true,
			data,
		});
	} catch (error) {
		next(error);
	}
};

export const toggleHabitHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = toggleHabitSchema.safeParse(req.body);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const result = await toggleHabit(userId, parsed.data);

		res.status(200).json({
			success: true,
			result,
		});
	} catch (error) {
		next(error);
	}
};

export const getMyHabitsHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const habits = await getMyHabits(userId);

		res.status(200).json({
			success: true,
			habits,
		});
	} catch (error) {
		next(error);
	}
};

export const createHabitHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = createHabitSchema.safeParse(req.body);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const habit = await createCustomHabit(userId, parsed.data);

		res.status(201).json({
			success: true,
			habit,
		});
	} catch (error) {
		next(error);
	}
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam))
		return null;
	return idParam;
};

export const updateHabitHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		const habitId = getIdParam(req.params.id);
		if (!userId || !habitId) {
			res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
			return;
		}

		const parsed = updateHabitSchema.safeParse(req.body);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const habit = await updateHabit(userId, habitId, parsed.data);

		res.status(200).json({
			success: true,
			habit,
		});
	} catch (error) {
		next(error);
	}
};

export const getHabitCatalogHandler: RequestHandler = async (_req, res, next) => {
	try {
		const catalog = getCuratedCatalog();
		res.status(200).json({
			success: true,
			catalog,
		});
	} catch (error) {
		next(error);
	}
};

export const getMemberHabitsForStaffHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const requesterRole = req.user?.role;
		if (
			!["admin", "frontdesk", "trainer", "nutritionist", "doctor"].includes(
				requesterRole || "",
			)
		) {
			res.status(403).json({
				error: "Forbidden: Staff access required",
				code: "FORBIDDEN",
			});
			return;
		}

		const targetUserId = getIdParam(req.params.userId);
		if (!targetUserId) {
			res.status(400).json({
				error: "Invalid target user id",
				code: "BAD_REQUEST",
			});
			return;
		}

		const habits = await getMyHabits(targetUserId);

		res.status(200).json({
			success: true,
			habits,
		});
	} catch (error) {
		next(error);
	}
};
