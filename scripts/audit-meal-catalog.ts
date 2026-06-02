/**
 * scripts/audit-meal-catalog.ts
 *
 * Read-only diagnostic — inspects all Excel-derived data stored in MongoDB
 * across the six meal-catalog collections. Does NOT touch users,
 * UserNutritionPlans, assignments, or meal logs.
 *
 * Usage:
 *   bun run scripts/audit-meal-catalog.ts
 *
 * Env vars required: MONGODB_URL
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import MealPlanCategory from "../src/models/MealPlanCategory";
import MealPlanImportRow from "../src/models/MealPlanImportRow";
import NutritionFood from "../src/models/nutrition-food.model";
import NutritionTemplate from "../src/models/nutrition-template.model";
import Recipe from "../src/models/Recipe";
import RecipeIngredient from "../src/models/RecipeIngredient";
import connectDB from "../src/utils/db";

config();

const BAR = "══════════════════════════════";
const DIVIDER = "-".repeat(75);

const fmt = (v: unknown): string =>
	v === null || v === undefined ? "null" : String(v);

const n = (v: number | null | undefined, decimals = 1): string => {
	if (v === null || v === undefined) return "null";
	const s = Number.isInteger(v)
		? String(v)
		: v.toFixed(decimals).replace(/\.?0+$/, "");
	return s;
};

const pad = (s: string, w: number): string => s.padEnd(w);

const section = (title: string) => {
	console.log("");
	console.log(BAR);
	console.log(title);
	console.log(BAR);
	console.log("");
};

async function main() {
	await connectDB();

	// ─── IMPORT SUMMARY ─────────────────────────────────────────────────────
	const [
		importRowCount,
		categoryCount,
		recipeCount,
		recipeIngredientCount,
		nutritionFoodCount,
		nutritionTemplateCount,
	] = await Promise.all([
		MealPlanImportRow.countDocuments(),
		MealPlanCategory.countDocuments(),
		Recipe.countDocuments(),
		RecipeIngredient.countDocuments(),
		NutritionFood.countDocuments(),
		NutritionTemplate.countDocuments(),
	]);

	section("IMPORT SUMMARY");
	console.log(`MealPlanImportRows:\n${importRowCount}\n`);
	console.log(`MealPlanCategories:\n${categoryCount}\n`);
	console.log(`Recipes:\n${recipeCount}\n`);
	console.log(`RecipeIngredients:\n${recipeIngredientCount}\n`);
	console.log(`NutritionFoods:\n${nutritionFoodCount}\n`);
	console.log(`NutritionTemplates:\n${nutritionTemplateCount}`);

	// ─── CATEGORIES ─────────────────────────────────────────────────────────
	section("CATEGORIES");
	const categories = await MealPlanCategory.find()
		.sort({ sortOrder: 1 })
		.lean();
	const recipesPerCategory = new Map<string, number>();
	for (const cat of categories) {
		const count = await Recipe.countDocuments({ categoryId: cat._id });
		recipesPerCategory.set(String(cat._id), count);
		console.log(cat.name);
		console.log(`Category Id: ${cat._id}`);
		console.log(`Recipes: ${count}`);
		console.log("");
	}

	// ─── RECIPES ────────────────────────────────────────────────────────────
	section("RECIPES");
	const recipes = await Recipe.find()
		.populate<{ categoryId: { name: string } | null }>("categoryId", "name")
		.sort({ name: 1 })
		.lean();

	// Column widths
	const C = { ing: 26, qty: 8, cal: 10, pro: 10, carb: 8, fat: 8, fib: 8 };
	const tableHeader =
		pad("Ingredient", C.ing) +
		pad("Qty", C.qty) +
		pad("Calories", C.cal) +
		pad("Protein", C.pro) +
		pad("Carbs", C.carb) +
		pad("Fat", C.fat) +
		"Fiber";

	const recipesWithZeroIngredients: string[] = [];

	for (const r of recipes) {
		const catName =
			r.categoryId && typeof r.categoryId === "object" && "name" in r.categoryId
				? (r.categoryId as { name: string }).name
				: "null";
		const t = r.totals ?? {};

		const ingredients = await RecipeIngredient.find({ recipeId: r._id })
			.sort({ sortOrder: 1 })
			.lean();

		if (ingredients.length === 0) recipesWithZeroIngredients.push(r.name);

		console.log(`Recipe: ${r.name}`);
		console.log(
			`Category: ${catName}   Id: ${r._id}   Ingredients: ${ingredients.length}`,
		);
		console.log("");
		console.log(tableHeader);
		console.log(DIVIDER);

		let sumCal = 0,
			sumPro = 0,
			sumCarb = 0,
			sumFat = 0,
			sumFib = 0;

		if (ingredients.length === 0) {
			console.log("  (none)");
		} else {
			for (const ing of ingredients) {
				const qty =
					ing.quantity !== null && ing.quantity !== undefined
						? `${n(ing.quantity)}${ing.unit ?? ""}`
						: fmt(ing.rawQuantityStr);
				console.log(
					pad(ing.rawIngredientName, C.ing) +
						pad(qty, C.qty) +
						pad(n(ing.caloriesKcal), C.cal) +
						pad(n(ing.proteinG), C.pro) +
						pad(n(ing.carbsG), C.carb) +
						pad(n(ing.fatG), C.fat) +
						n(ing.fiberG),
				);
				sumCal += ing.caloriesKcal ?? 0;
				sumPro += ing.proteinG ?? 0;
				sumCarb += ing.carbsG ?? 0;
				sumFat += ing.fatG ?? 0;
				sumFib += ing.fiberG ?? 0;
			}
		}

		console.log(DIVIDER);
		console.log(
			pad("TOTAL", C.ing + C.qty) +
				pad(n(sumCal), C.cal) +
				pad(n(sumPro), C.pro) +
				pad(n(sumCarb), C.carb) +
				pad(n(sumFat), C.fat) +
				n(sumFib),
		);

		// Verify computed totals match stored recipe.totals
		const eps = 0.15;
		const storedCal = t.caloriesKcal ?? 0;
		const storedPro = t.proteinG ?? 0;
		const storedCarb = t.carbsG ?? 0;
		const storedFat = t.fatG ?? 0;
		const totalMatch =
			Math.abs(sumCal - storedCal) <= eps &&
			Math.abs(sumPro - storedPro) <= eps &&
			Math.abs(sumCarb - storedCarb) <= eps &&
			Math.abs(sumFat - storedFat) <= eps;
		if (totalMatch) {
			console.log(
				`Totals: PASS (stored: ${n(storedCal)} kcal / ${n(storedPro)}P / ${n(storedCarb)}C / ${n(storedFat)}F)`,
			);
		} else {
			console.log(
				`Totals: FAIL — stored ${n(storedCal)} kcal / ${n(storedPro)}P / ${n(storedCarb)}C / ${n(storedFat)}F` +
					`  vs  computed ${n(sumCal)} / ${n(sumPro)}P / ${n(sumCarb)}C / ${n(sumFat)}F`,
			);
		}
		console.log("");
	}

	// ─── NUTRITION FOODS ────────────────────────────────────────────────────
	section("NUTRITION FOODS");
	const foods = await NutritionFood.find().sort({ name: 1 }).lean();
	for (const f of foods) {
		console.log(f.name);
		console.log(`Base Quantity: ${fmt(f.basePer)}`);
		console.log(`Calories: ${fmt(f.caloriesKcal)}`);
		console.log(`Protein: ${fmt(f.proteinG)}`);
		console.log(`Carbs: ${fmt(f.carbsG)}`);
		console.log(`Fat: ${fmt(f.fatG)}`);
		console.log("");
	}

	// ─── TEMPLATE INVENTORY ─────────────────────────────────────────────────
	section("TEMPLATE INVENTORY");
	const templates = await NutritionTemplate.find().sort({ name: 1 }).lean();
	const templatesWithEmptyMeals: string[] = [];
	const templatesWithoutRecipeRefs: string[] = [];
	for (const tpl of templates) {
		const days = tpl.days ?? [];
		let mealCount = 0;
		let ingredientCount = 0;
		const recipeIds = new Set<string>();
		for (const day of days) {
			const meals = day.meals ?? [];
			mealCount += meals.length;
			for (const meal of meals) {
				ingredientCount += (meal.items ?? []).length;
				if (meal.recipeId) recipeIds.add(String(meal.recipeId));
			}
		}
		if (mealCount === 0) templatesWithEmptyMeals.push(tpl.name);
		if (recipeIds.size === 0) templatesWithoutRecipeRefs.push(tpl.name);

		console.log(tpl.name);
		console.log(`Template Id: ${tpl._id}`);
		console.log(`Recipe Count: ${recipeIds.size}`);
		console.log(`Meal Count: ${mealCount}`);
		console.log(`Ingredient Count: ${ingredientCount}`);
		console.log("");
	}

	// ─── DATA INTEGRITY CHECKS ──────────────────────────────────────────────
	section("DATA INTEGRITY CHECKS");

	const categoriesZero = [...recipesPerCategory.entries()]
		.filter(([, n]) => n === 0)
		.map(([id]) => id);
	console.log(
		`Categories with zero recipes: ${categoriesZero.length === 0 ? "PASS" : `FAIL (${categoriesZero.length})`}`,
	);

	console.log(
		`Recipes with zero ingredients: ${recipesWithZeroIngredients.length === 0 ? "PASS" : `FAIL (${recipesWithZeroIngredients.length}) — e.g. ${recipesWithZeroIngredients.slice(0, 3).join(", ")}`}`,
	);

	const nullFoodId = await RecipeIngredient.countDocuments({ foodId: null });
	console.log(
		`RecipeIngredients with null foodId: ${nullFoodId === 0 ? "PASS" : `FAIL (${nullFoodId})`}`,
	);

	console.log(
		`Templates with empty meals: ${templatesWithEmptyMeals.length === 0 ? "PASS" : `FAIL (${templatesWithEmptyMeals.length}) — ${templatesWithEmptyMeals.slice(0, 3).join(", ")}`}`,
	);

	console.log(
		`Templates without recipeId references: ${templatesWithoutRecipeRefs.length === 0 ? "PASS" : `FAIL (${templatesWithoutRecipeRefs.length}) — ${templatesWithoutRecipeRefs.slice(0, 3).join(", ")}`}`,
	);

	const dupRecipes = await Recipe.aggregate([
		{
			$group: {
				_id: { name: "$name", categoryId: "$categoryId" },
				count: { $sum: 1 },
			},
		},
		{ $match: { count: { $gt: 1 } } },
	]);
	console.log(
		`Duplicate recipes: ${dupRecipes.length === 0 ? "PASS" : `FAIL (${dupRecipes.length})`}`,
	);

	const dupIngredients = await RecipeIngredient.aggregate([
		{
			$group: {
				_id: {
					recipeId: "$recipeId",
					rawIngredientName: "$rawIngredientName",
					sortOrder: "$sortOrder",
				},
				count: { $sum: 1 },
			},
		},
		{ $match: { count: { $gt: 1 } } },
	]);
	console.log(
		`Duplicate ingredients: ${dupIngredients.length === 0 ? "PASS" : `FAIL (${dupIngredients.length})`}`,
	);

	console.log("");
}

main()
	.catch((err) => {
		console.error("❌ Audit failed:", err);
		process.exitCode = 1;
	})
	.finally(async () => {
		await mongoose.disconnect();
	});
