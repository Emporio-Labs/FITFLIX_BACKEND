import type { RequestHandler } from "express";
import { z } from "zod";
import { NutritionGoal } from "../models/Enums";
import {
	buildTemplateFromCategoryBody,
	buildTemplateFromRecipeBody,
	recipeBrowseQuerySchema,
} from "../validators/nutrition-recipe.validator";
import {
	createTemplateFromCategory,
	createTemplateFromRecipe,
	getRecipeWithIngredients,
	listCategories,
	listRecipes,
	listRecipesByCategory,
} from "../services/nutrition/nutrition-recipe.service";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";

// ─────────────────────────────────────────────────────────────────────────────
// Browse
// ─────────────────────────────────────────────────────────────────────────────

export const listCategoriesHandler: RequestHandler = async (_req, res, next) => {
	try {
		const categories = await listCategories();
		res.status(200).json({ categories });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listRecipesByCategoryHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = recipeBrowseQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const categoryId = requireIdParam(
			req.params.categoryId,
			"Category not found",
		);
		const result = await listRecipesByCategory(categoryId, parsed.data);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listRecipesHandler: RequestHandler = async (req, res, next) => {
	const parsed = recipeBrowseQuerySchema
		.extend({ categoryId: z.string().optional() })
		.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const result = await listRecipes(parsed.data);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getRecipeHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = requireIdParam(req.params.id, "Recipe not found");
		const result = await getRecipeWithIngredients(id);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Template builders
// ─────────────────────────────────────────────────────────────────────────────

export const buildTemplateFromCategoryHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = buildTemplateFromCategoryBody.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const categoryId = requireIdParam(
			req.params.categoryId,
			"Category not found",
		);
		const { template, skippedIngredients, recipeCount } =
			await createTemplateFromCategory(
				categoryId,
				parsed.data,
				req.user!.id,
			);
		res.status(201).json({
			message: "Template created from category",
			template,
			recipeCount,
			skippedIngredients,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const buildTemplateFromRecipeHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = buildTemplateFromRecipeBody.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const recipeId = requireIdParam(req.params.recipeId, "Recipe not found");
		const { template, totals, skippedIngredients } =
			await createTemplateFromRecipe(recipeId, parsed.data, req.user!.id);
		res.status(201).json({
			message: "Template created from recipe",
			template,
			totals,
			skippedIngredients,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
