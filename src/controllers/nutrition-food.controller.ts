import type { RequestHandler } from "express";
import { NutritionFoodSource } from "../models/Enums";
import {
	createFood,
	deactivateFood,
	searchFoods,
	updateFood,
} from "../services/nutrition/nutrition-food.service";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	createFoodBodySchema,
	foodSearchQuerySchema,
	updateFoodBodySchema,
} from "../validators/nutrition-food.validator";

export const createCustomFood: RequestHandler = async (req, res, next) => {
	const parsed = createFoodBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const food = await createFood(
			parsed.data,
			req.user!.id,
			NutritionFoodSource.Custom,
		);
		res.status(201).json({ message: "Food created", food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const createSystemFood: RequestHandler = async (req, res, next) => {
	const parsed = createFoodBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const food = await createFood(
			parsed.data,
			req.user!.id,
			NutritionFoodSource.System,
		);
		res.status(201).json({ message: "System food created", food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listFoods: RequestHandler = async (req, res, next) => {
	const parsed = foodSearchQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const role = req.user!.role;
		const result = await searchFoods({
			query: parsed.data.query,
			page: parsed.data.page,
			limit: parsed.data.limit,
			// Users only ever see system foods; nutritionists see system +
			// their own custom foods.
			...(role === "user"
				? { source: NutritionFoodSource.System }
				: { systemAndOwner: req.user!.id }),
		});
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const patchFood: RequestHandler = async (req, res, next) => {
	const parsed = updateFoodBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const id = requireIdParam(req.params.id, "Food not found");
		const food = await updateFood(id, parsed.data, req.user!);
		res.status(200).json({ message: "Food updated", food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const removeFood: RequestHandler = async (req, res, next) => {
	try {
		const id = requireIdParam(req.params.id, "Food not found");
		await deactivateFood(id, req.user!);
		res.status(200).json({ message: "Food deactivated" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
