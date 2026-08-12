import type { RequestHandler } from "express";
import { NutritionFoodSource } from "../models/Enums";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	lookupBarcode,
	searchFoodsUnified,
} from "../services/nutrition/nutrition-external-food.service";
import {
	createFood,
	deactivateFood,
	searchFoods,
	updateFood,
} from "../services/nutrition/nutrition-food.service";
import {
	createFoodBodySchema,
	foodSearchQuerySchema,
	unifiedFoodSearchQuerySchema,
	updateFoodBodySchema,
} from "../validators/nutrition-food.validator";

export const createCustomFood: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

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
			requester.id,
			NutritionFoodSource.Custom,
		);
		res.status(201).json({ message: "Food created", food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const createSystemFood: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

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
			requester.id,
			NutritionFoodSource.System,
		);
		res.status(201).json({ message: "System food created", food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listFoods: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

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
		const role = requester.role;
		const result = await searchFoods({
			query: parsed.data.query,
			page: parsed.data.page,
			limit: parsed.data.limit,
			// Users see system foods + foods cached in from an external database
			// (e.g. Open Food Facts) when a member previously logged them;
			// nutritionists see system + their own custom foods.
			...(role === "user"
				? {
						source: [NutritionFoodSource.System, NutritionFoodSource.External],
					}
				: { systemAndOwner: requester.id }),
		});
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const patchFood: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

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
		const food = await updateFood(id, parsed.data, requester);
		res.status(200).json({ message: "Food updated", food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

// GET /nutrition/foods/search — local catalog + Open Food Facts, merged and
// deduped by barcode. External hits are unsaved previews (externalRef, no
// _id) until a member actually logs one (see ensureExternalFoodPersisted).
export const searchFoodsHandler: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = unifiedFoodSearchQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const result = await searchFoodsUnified({
			query: parsed.data.query,
			page: parsed.data.page,
			limit: parsed.data.limit,
			actor: requester,
		});
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

// GET /nutrition/foods/barcode/:code — local catalog first, Open Food Facts
// on miss. Local always wins so nutritionist corrections stick.
export const lookupBarcodeHandler: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const code = req.params.code;
	if (typeof code !== "string" || code.trim() === "") {
		res.status(400).json({ error: "Invalid barcode", code: "BAD_REQUEST" });
		return;
	}

	try {
		const food = await lookupBarcode(code.trim());
		if (!food) {
			res.status(404).json({ error: "Food not found", code: "NOT_FOUND" });
			return;
		}
		res.status(200).json({ food });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const removeFood: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const id = requireIdParam(req.params.id, "Food not found");
		await deactivateFood(id, requester);
		res.status(200).json({ message: "Food deactivated" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
