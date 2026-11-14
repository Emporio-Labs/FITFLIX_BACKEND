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
	deleteProgressEntry,
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
		id: obj._id ? String(obj._id) : undefined,
		_id: obj._id ? String(obj._id) : undefined,
		date: recordedAt,
		recordedAt,
		weight: weightKg,
		weightKg,
		notes: note,
		note,
		bodyFatPct: obj.bodyFatPct ?? null,
		measurements: obj.measurements ?? {},
		photoUrls: obj.photoUrls ?? [],
		recordedBy: obj.recordedBy ?? "user",
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
		const serialized = entries.map(serializeProgress);
		res.status(200).json({ entries: serialized, items: serialized });
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

export const deleteMyProgress: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const id = requireIdParam(req.params.id, "Progress entry not found");
		const doc = await deleteProgressEntry(id, requester.id);
		if (!doc) {
			res
				.status(404)
				.json({ error: "Progress entry not found", code: "NOT_FOUND" });
			return;
		}
		res.status(200).json({ success: true, message: "Progress entry deleted" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
