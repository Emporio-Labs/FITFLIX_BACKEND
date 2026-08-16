import { config } from "dotenv";
import mongoose from "mongoose";
import Recipe from "../src/models/Recipe";
import "../src/models/User";
import NutritionFood from "../src/models/nutrition-food.model";
import NutritionMealLog from "../src/models/nutrition-meal-log.model";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import NutritionTemplate from "../src/models/nutrition-template.model";
import connectDB from "../src/utils/db";

config();

function norm(s: string): string {
	return (s || "").trim().toLowerCase();
}

async function run() {
	await connectDB();
	console.log("Connected to MongoDB.");

	const recipes = await Recipe.find({}).lean();

	// Map of recipeId -> Recipe
	const recipeMap = new Map(recipes.map((r) => [r._id.toString(), r]));
	// Map of lowerRecipeName -> Recipe
	const recipeNameMap = new Map(recipes.map((r) => [norm(r.name), r]));

	// Helper to find a recipe given foods list or existing fields
	function matchRecipe(opt: any, mealName: string): { recipeId: string | null; recipeName: string | null } {
		if (opt.recipeId && recipeMap.has(opt.recipeId.toString())) {
			const r = recipeMap.get(opt.recipeId.toString())!;
			return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (opt.recipeName && recipeNameMap.has(norm(opt.recipeName))) {
			const r = recipeNameMap.get(norm(opt.recipeName))!;
			return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (opt.title && !/^Option\s*\d+$/i.test(opt.title) && recipeNameMap.has(norm(opt.title))) {
			const r = recipeNameMap.get(norm(opt.title))!;
			return { recipeId: r._id.toString(), recipeName: r.name };
		}

		// Try matching by food names
		const foodNames = (opt.foods || []).map((f: any) => norm(f.foodName || f.name || "")).filter(Boolean);

		if (foodNames.some((n: string) => n.includes("beetroot")) && foodNames.some((n: string) => n.includes("apple"))) {
			const r = recipeNameMap.get("abc juice");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("chicken")) && foodNames.some((n: string) => n.includes("cheese")) && foodNames.some((n: string) => n.includes("bread"))) {
			const r = recipeNameMap.get("chicken cheese sandwich");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("chicken")) && foodNames.some((n: string) => n.includes("rice")) && foodNames.some((n: string) => n.includes("avocado"))) {
			const r = recipeNameMap.get("grilled chicken avocado rice bowl");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("chicken")) && (foodNames.some((n: string) => n.includes("lettuce")) || foodNames.some((n: string) => n.includes("cucumber")))) {
			const r = recipeNameMap.get("peri peri chicken salad") || recipeNameMap.get("garlic chicken salad");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("rice")) && foodNames.some((n: string) => n.includes("peri peri"))) {
			const r = recipeNameMap.get("peri peri rice bowl");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("watermelon")) && foodNames.some((n: string) => n.includes("banana"))) {
			const r = recipeNameMap.get("watermelon banana smoothie");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("paneer")) && foodNames.some((n: string) => n.includes("bread"))) {
			const r = recipeNameMap.get("paneer sandwich") || recipeNameMap.get("paneer cheese sandwich");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("broccoli")) && (foodNames.some((n: string) => n.includes("egg")) || foodNames.some((n: string) => n.includes("omlette")))) {
			const r = recipeNameMap.get("broccoli omlette salad");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("chickpea"))) {
			const r = recipeNameMap.get("chickpea vegetable salad");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("rajma"))) {
			const r = recipeNameMap.get("rajma vegetable salad");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		if (foodNames.some((n: string) => n.includes("boiled egg") || (n.includes("egg") && !n.includes("broccoli")))) {
			const r = recipeNameMap.get("boiled egg salad");
			if (r) return { recipeId: r._id.toString(), recipeName: r.name };
		}

		// Fallback: check if meal name matches a recipe
		if (recipeNameMap.has(norm(mealName))) {
			const r = recipeNameMap.get(norm(mealName))!;
			return { recipeId: r._id.toString(), recipeName: r.name };
		}

		return {
			recipeId: opt.recipeId ? opt.recipeId.toString() : null,
			recipeName: opt.recipeName || (!/^Option\s*\d+$/i.test(opt.title || "") ? opt.title : null),
		};
	}

	// 1. Heal UserNutritionPlans
	const plans = await UserNutritionPlan.find({});
	console.log(`Found ${plans.length} UserNutritionPlans to heal.`);

	for (const plan of plans) {
		let modified = false;
		for (const day of plan.days || []) {
			for (const meal of day.meals || []) {
				for (const opt of meal.options || []) {
					const matched = matchRecipe(opt, meal.name);
					if (matched.recipeName) {
						if (!opt.recipeName || opt.recipeName !== matched.recipeName) {
							opt.recipeName = matched.recipeName;
							modified = true;
						}
						if (!opt.recipeId && matched.recipeId) {
							opt.recipeId = matched.recipeId;
							modified = true;
						}
						if (!opt.title || /^Option\s*\d+$/i.test(opt.title)) {
							opt.title = matched.recipeName;
							modified = true;
						}
						// Also populate food recipeSource
						for (const food of opt.foods || []) {
							if (!food.recipeSource) {
								food.recipeSource = matched.recipeName;
								modified = true;
							}
						}
					}
				}
			}
		}
		if (modified) {
			plan.markModified("days");
			await plan.save();
			console.log(`Updated plan: ${plan.name} (${plan._id})`);
		}
	}

	// 2. Heal NutritionTemplates
	const templates = await NutritionTemplate.find({});
	console.log(`Found ${templates.length} NutritionTemplates to heal.`);

	for (const tmpl of templates) {
		let modified = false;
		for (const day of tmpl.days || []) {
			for (const meal of day.meals || []) {
				for (const opt of meal.options || []) {
					const matched = matchRecipe(opt, meal.name);
					if (matched.recipeName) {
						if (!opt.recipeName || opt.recipeName !== matched.recipeName) {
							opt.recipeName = matched.recipeName;
							modified = true;
						}
						if (!opt.recipeId && matched.recipeId) {
							opt.recipeId = matched.recipeId;
							modified = true;
						}
						if (!opt.title || /^Option\s*\d+$/i.test(opt.title)) {
							opt.title = matched.recipeName;
							modified = true;
						}
						for (const food of opt.foods || []) {
							if (!food.recipeSource) {
								food.recipeSource = matched.recipeName;
								modified = true;
							}
						}
					}
				}
			}
		}
		if (modified) {
			tmpl.markModified("days");
			await tmpl.save();
			console.log(`Updated template: ${tmpl.name} (${tmpl._id})`);
		}
	}

	// 3. Heal NutritionMealLogs (Diary & History records)
	const mealLogs = await NutritionMealLog.find({});
	console.log(`Found ${mealLogs.length} NutritionMealLogs to heal.`);

	for (const log of mealLogs) {
		let modified = false;
		const rawNotes = (log.notes || "").trim();
		const isPlaceholder = !rawNotes || /^Option\s*\d+$/i.test(rawNotes) || ["breakfast", "lunch", "dinner", "snack", "preworkout", "postworkout", "earlymorning", "custom", "breakfast meal", "lunch meal", "dinner meal", "snack meal", "postworkout meal", "preworkout meal"].includes(rawNotes.toLowerCase().replace(/[\s\-_]/g, ""));

		const matched = matchRecipe({ foods: log.items, title: log.notes }, log.mealType || "");
		if (matched.recipeName) {
			if (log.notes !== matched.recipeName) {
				log.notes = matched.recipeName;
				modified = true;
			}
			for (const food of log.items || []) {
				if (!(food as any).recipeSource) {
					(food as any).recipeSource = matched.recipeName;
					modified = true;
				}
			}
		} else if (isPlaceholder && log.items && log.items.length > 0) {
			const fallbackTitle = log.items.length === 1 ? log.items[0].foodName : log.items.map((i: any) => i.foodName).filter(Boolean).join(", ");
			if (fallbackTitle && log.notes !== fallbackTitle) {
				log.notes = fallbackTitle;
				modified = true;
			}
		}

		if (log.status && typeof log.status === "string") {
			const normStatus = log.status.charAt(0).toUpperCase() + log.status.slice(1).toLowerCase();
			if (["Logged", "Skipped"].includes(normStatus) && log.status !== normStatus) {
				log.status = normStatus as any;
				modified = true;
			}
		}

		if (modified) {
			log.markModified("items");
			await log.save({ validateBeforeSave: false });
			console.log(`Updated meal log ${log._id} -> notes: "${log.notes}"`);
		}
	}

	console.log("Migration complete!");
	process.exit(0);
}

run().catch((e) => {
	console.error("Migration failed:", e);
	process.exit(1);
});
