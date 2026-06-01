import mongoose from "mongoose";
import { MealType, NutritionGoal, NutritionPlanStatus } from "../../models/Enums";
import MealPlanCategory, {
	type MealPlanCategoryDocument,
} from "../../models/MealPlanCategory";
import Recipe, { type RecipeDocument } from "../../models/Recipe";
import RecipeIngredient, {
	type RecipeIngredientDocument,
} from "../../models/RecipeIngredient";
import NutritionTemplate from "../../models/nutrition-template.model";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import { sumMacros } from "./nutrition-macro.util";
import type { MacroTotals } from "../../types/nutrition";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MealSnapshot = {
	mealType: string;
	name: string;
	recipeId: mongoose.Types.ObjectId;
	timeOfDay: null;
	notes: string;
	items: ItemSnapshot[];
	options: never[];
	cookingDirections: string[];
	prepTimeMinutes: number | null;
};

type ItemSnapshot = {
	foodId: mongoose.Types.ObjectId;
	foodName: string;
	quantityG: number;
	unit: string;
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG: number | null;
	sugarG: number | null;
};

type DaySnapshot = {
	dayNumber: number;
	meals: MealSnapshot[];
};

export type BuildMealResult = {
	meal: MealSnapshot;
	totals: MacroTotals;
	skippedIngredients: string[];
};

export type BuildCategoryResult = {
	days: DaySnapshot[];
	skippedIngredients: string[];
	recipeCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Core bridge — RecipeIngredient → mealFoodItemSchema snapshot
// ─────────────────────────────────────────────────────────────────────────────

// Constructs a fully-formed template meal snapshot from a Recipe and its
// RecipeIngredient rows. Bypasses resolveDaysToSnapshots intentionally:
// the import script stored verbatim per-portion macros on RecipeIngredient,
// not normalised per-100g values. Re-scaling via NutritionFood would corrupt
// the numbers. Verbatim Excel values are used directly here.
export const buildMealSnapshotFromRecipe = async (
	recipeId: string,
): Promise<BuildMealResult> => {
	const id = toObjectId(recipeId, "NOT_FOUND", "Recipe not found");
	const recipe = await Recipe.findOne({ _id: id, isActive: true }).lean();
	if (!recipe) {
		throw new NutritionServiceError("NOT_FOUND", "Recipe not found");
	}

	const ingredients = await RecipeIngredient.find({ recipeId: id })
		.sort({ sortOrder: 1 })
		.lean();

	const skippedIngredients: string[] = [];
	const items: ItemSnapshot[] = [];

	for (const ing of ingredients) {
		if (!ing.foodId) {
			skippedIngredients.push(ing.rawIngredientName);
			continue;
		}
		items.push({
			foodId: ing.foodId as mongoose.Types.ObjectId,
			foodName: ing.rawIngredientName,
			quantityG: ing.quantity ?? 0,
			unit: ing.unit ?? "g",
			caloriesKcal: ing.caloriesKcal ?? 0,
			proteinG: ing.proteinG ?? 0,
			carbsG: ing.carbsG ?? 0,
			fatG: ing.fatG ?? 0,
			fiberG: ing.fiberG ?? null,
			sugarG: ing.sugarG ?? null,
		});
	}

	const totals = sumMacros(items);

	const meal: MealSnapshot = {
		mealType: (recipe.defaultMealType as string) ?? MealType.Lunch,
		name: recipe.name,
		recipeId: recipe._id as mongoose.Types.ObjectId,
		timeOfDay: null,
		notes: "",
		items,
		options: [],
		cookingDirections: (recipe.cookingDirections as string[]) ?? [],
		prepTimeMinutes: (recipe.prepTimeMinutes as number | null) ?? null,
	};

	return { meal, totals, skippedIngredients };
};

// ─────────────────────────────────────────────────────────────────────────────
// Category-level builder
// ─────────────────────────────────────────────────────────────────────────────

export const buildTemplateDaysFromCategory = async (
	categoryId: string,
): Promise<BuildCategoryResult> => {
	const catId = toObjectId(categoryId, "NOT_FOUND", "Category not found");
	const recipes = await Recipe.find({ categoryId: catId, isActive: true })
		.sort({ name: 1 })
		.lean();

	if (recipes.length === 0) {
		throw new NutritionServiceError(
			"NOT_FOUND",
			"No active recipes found for this category",
		);
	}

	const meals: MealSnapshot[] = [];
	const allSkipped: string[] = [];

	for (const recipe of recipes) {
		const { meal, skippedIngredients } = await buildMealSnapshotFromRecipe(
			(recipe._id as mongoose.Types.ObjectId).toString(),
		);
		meals.push(meal);
		allSkipped.push(...skippedIngredients);
	}

	return {
		days: [{ dayNumber: 1, meals }],
		skippedIngredients: allSkipped,
		recipeCount: recipes.length,
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Template creation helpers
// ─────────────────────────────────────────────────────────────────────────────

type TemplateInput = {
	name: string;
	goal: NutritionGoal;
	tags?: string[];
};

export const createTemplateFromCategory = async (
	categoryId: string,
	input: TemplateInput,
	nutritionistId: string,
) => {
	const ownerId = toObjectId(
		nutritionistId,
		"BAD_REQUEST",
		"Invalid nutritionist ID",
	);

	const { days, skippedIngredients, recipeCount } =
		await buildTemplateDaysFromCategory(categoryId);

	// Derive target calories from the sum of all meal items in day 1.
	// buildTemplateDaysFromCategory always returns at least one day, but
	// TypeScript cannot prove that from the array type.
	const allItems = (days[0]?.meals ?? []).flatMap((m) => m.items);
	const totals = sumMacros(allItems);

	const template = await NutritionTemplate.create({
		name: input.name,
		description: "",
		createdBy: ownerId,
		goal: input.goal,
		status: NutritionPlanStatus.Draft,
		tags: input.tags ?? [],
		targetCaloriesKcal: totals.caloriesKcal > 0 ? totals.caloriesKcal : null,
		targetMacros: {
			proteinG: totals.proteinG > 0 ? totals.proteinG : null,
			carbsG: totals.carbsG > 0 ? totals.carbsG : null,
			fatG: totals.fatG > 0 ? totals.fatG : null,
			fiberG: totals.fiberG > 0 ? totals.fiberG : null,
			sugarG: totals.sugarG > 0 ? totals.sugarG : null,
		},
		durationDays: 1,
		days,
		lifestyleRecommendations: [],
	});

	return { template, skippedIngredients, recipeCount };
};

export const createTemplateFromRecipe = async (
	recipeId: string,
	input: TemplateInput,
	nutritionistId: string,
) => {
	const ownerId = toObjectId(
		nutritionistId,
		"BAD_REQUEST",
		"Invalid nutritionist ID",
	);

	const { meal, totals, skippedIngredients } =
		await buildMealSnapshotFromRecipe(recipeId);

	const template = await NutritionTemplate.create({
		name: input.name,
		description: "",
		createdBy: ownerId,
		goal: input.goal,
		status: NutritionPlanStatus.Draft,
		tags: input.tags ?? [],
		targetCaloriesKcal: totals.caloriesKcal > 0 ? totals.caloriesKcal : null,
		targetMacros: {
			proteinG: totals.proteinG > 0 ? totals.proteinG : null,
			carbsG: totals.carbsG > 0 ? totals.carbsG : null,
			fatG: totals.fatG > 0 ? totals.fatG : null,
			fiberG: totals.fiberG > 0 ? totals.fiberG : null,
			sugarG: totals.sugarG > 0 ? totals.sugarG : null,
		},
		durationDays: 1,
		days: [{ dayNumber: 1, meals: [meal] }],
		lifestyleRecommendations: [],
	});

	return { template, totals, skippedIngredients };
};

// ─────────────────────────────────────────────────────────────────────────────
// Browse / read-only functions
// ─────────────────────────────────────────────────────────────────────────────

export const listCategories = async (): Promise<MealPlanCategoryDocument[]> =>
	MealPlanCategory.find().sort({ sortOrder: 1 }).lean() as Promise<
		MealPlanCategoryDocument[]
	>;

type RecipeListOpts = {
	isVeg?: boolean;
	page?: number;
	limit?: number;
};

export const listRecipesByCategory = async (
	categoryId: string,
	opts: RecipeListOpts = {},
): Promise<{ recipes: RecipeDocument[]; total: number }> => {
	const catId = toObjectId(categoryId, "NOT_FOUND", "Category not found");
	const { page = 1, limit = 50, isVeg } = opts;
	const filter: Record<string, unknown> = { categoryId: catId, isActive: true };
	if (isVeg !== undefined) filter.isVeg = isVeg;

	const [recipes, total] = await Promise.all([
		Recipe.find(filter)
			.sort({ name: 1 })
			.skip((page - 1) * limit)
			.limit(limit)
			.lean(),
		Recipe.countDocuments(filter),
	]);
	return { recipes: recipes as RecipeDocument[], total };
};

type RecipesOpts = RecipeListOpts & { categoryId?: string };

export const listRecipes = async (
	opts: RecipesOpts = {},
): Promise<{ recipes: RecipeDocument[]; total: number }> => {
	const { page = 1, limit = 50, isVeg, categoryId } = opts;
	const filter: Record<string, unknown> = { isActive: true };
	if (categoryId) {
		filter.categoryId = toObjectId(categoryId, "BAD_REQUEST", "Invalid category ID");
	}
	if (isVeg !== undefined) filter.isVeg = isVeg;

	const [recipes, total] = await Promise.all([
		Recipe.find(filter)
			.sort({ name: 1 })
			.skip((page - 1) * limit)
			.limit(limit)
			.lean(),
		Recipe.countDocuments(filter),
	]);
	return { recipes: recipes as RecipeDocument[], total };
};

export const getRecipeWithIngredients = async (
	recipeId: string,
): Promise<{ recipe: RecipeDocument; ingredients: RecipeIngredientDocument[] }> => {
	const id = toObjectId(recipeId, "NOT_FOUND", "Recipe not found");
	const recipe = await Recipe.findOne({ _id: id, isActive: true }).lean();
	if (!recipe) {
		throw new NutritionServiceError("NOT_FOUND", "Recipe not found");
	}
	const ingredients = await RecipeIngredient.find({ recipeId: id })
		.sort({ sortOrder: 1 })
		.lean();
	return {
		recipe: recipe as RecipeDocument,
		ingredients: ingredients as RecipeIngredientDocument[],
	};
};
