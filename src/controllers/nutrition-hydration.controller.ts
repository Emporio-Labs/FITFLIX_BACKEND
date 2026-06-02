import type { RequestHandler } from "express";
import {
	getValidationDetails,
	handleNutritionError,
} from "../services/nutrition/nutrition-errors";
import {
	addHydration,
	getHydration,
	setHydrationGoal,
} from "../services/nutrition/nutrition-hydration.service";
import {
	addHydrationBodySchema,
	hydrationGoalBodySchema,
	hydrationQuerySchema,
} from "../validators/nutrition-hydration.validator";

export const addHydrationIntake: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = addHydrationBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const hydration = await addHydration(
			requester.id,
			parsed.data.amountMl,
			parsed.data.source,
			parsed.data.date,
		);
		res.status(201).json({ message: "Hydration logged", hydration });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const updateHydrationGoal: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = hydrationGoalBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const hydration = await setHydrationGoal(
			requester.id,
			parsed.data.goalMl,
			parsed.data.date,
		);
		res.status(200).json({ message: "Hydration goal set", hydration });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getMyHydration: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = hydrationQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const isStaff = ["nutritionist", "admin"].includes(requester.role);
		const targetUserId =
			isStaff && parsed.data.userId ? parsed.data.userId : requester.id;
		const hydration = await getHydration(targetUserId, parsed.data.date);
		res.status(200).json({ hydration });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
