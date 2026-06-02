import type { RequestHandler } from "express";
import { ProgressRecordedBy } from "../models/Enums";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	addPlanProgress,
	addProgressEntry,
	getPlanProgress,
	listProgress,
} from "../services/nutrition/nutrition-progress.service";
import {
	progressBodySchema,
	progressListQuerySchema,
} from "../validators/nutrition-progress.validator";

const serializeProgress = (entry: unknown) => {
	if (!entry) return entry;
	const typedEntry = entry as Record<string, unknown> & {
		toObject?: () => Record<string, unknown>;
	};
	const obj =
		typedEntry.toObject && typeof typedEntry.toObject === "function"
			? typedEntry.toObject()
			: { ...typedEntry };
	const { recordedAt, weightKg, note, ...rest } = obj;
	return {
		...rest,
		date: recordedAt,
		weight: weightKg,
		notes: note,
	};
};

export const addMyProgress: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = progressBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const entry = await addProgressEntry(
			parsed.data,
			requester.id,
			ProgressRecordedBy.User,
		);
		res
			.status(201)
			.json({ message: "Progress recorded", entry: serializeProgress(entry) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listMyProgress: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = progressListQuerySchema.safeParse(req.query);
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
		const entries = await listProgress(targetUserId, parsed.data);
		res.status(200).json({ entries: entries.map(serializeProgress) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listPlanProgress: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const entries = await getPlanProgress(planId, requester);
		res.status(200).json({ entries: entries.map(serializeProgress) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const addPlanProgressEntry: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = progressBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const entry = await addPlanProgress(planId, parsed.data, requester);
		res
			.status(201)
			.json({ message: "Progress recorded", entry: serializeProgress(entry) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
