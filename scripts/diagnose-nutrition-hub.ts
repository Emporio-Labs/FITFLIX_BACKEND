/**
 * scripts/diagnose-nutrition-hub.ts
 *
 * Full ingredient-level diagnostic for a user's active UserNutritionPlan.
 *
 * Traces data at four layers in order:
 *   1. UserNutritionPlan.days[].meals[].items[]         (deep snapshot = "live plan data")
 *   2. UserNutritionPlan.days[].meals[].options[]       (multi-choice options)
 *   3. Recipe → RecipeIngredient                        (canonical catalog reference)
 *   4. NutritionTemplate                                (source template snapshot)
 *
 * Usage:
 *   bun run scripts/diagnose-nutrition-hub.ts [email]
 *   bun run scripts/diagnose-nutrition-hub.ts rahul@fitflix.in
 *
 * Env vars required: MONGODB_URL
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import { NutritionPlanStatus } from "../src/models/Enums";
import MealPlanCategory from "../src/models/MealPlanCategory";
import NutritionFood from "../src/models/nutrition-food.model";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import NutritionTemplate from "../src/models/nutrition-template.model";
import Recipe from "../src/models/Recipe";
import RecipeIngredient from "../src/models/RecipeIngredient";
import User from "../src/models/User";
import connectDB from "../src/utils/db";

config();

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

const hr = (char = "─", len = 70) => char.repeat(len);
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const fmt = (n: number | null | undefined, unit = "", decimals = 1) =>
	n == null ? dim("—") : `${Number(n).toFixed(decimals)}${unit}`;

type MacroRow = {
	caloriesKcal?: number | null;
	proteinG?: number | null;
	carbsG?: number | null;
	fatG?: number | null;
	fiberG?: number | null;
};

const addMacros = (acc: MacroRow, row: MacroRow): MacroRow => ({
	caloriesKcal: (acc.caloriesKcal ?? 0) + (row.caloriesKcal ?? 0),
	proteinG: (acc.proteinG ?? 0) + (row.proteinG ?? 0),
	carbsG: (acc.carbsG ?? 0) + (row.carbsG ?? 0),
	fatG: (acc.fatG ?? 0) + (row.fatG ?? 0),
	fiberG: (acc.fiberG ?? 0) + (row.fiberG ?? 0),
});

const zeroMacros = (): MacroRow => ({
	caloriesKcal: 0,
	proteinG: 0,
	carbsG: 0,
	fatG: 0,
	fiberG: 0,
});

const printMacroLine = (label: string, m: MacroRow, indent = "  ") => {
	console.log(
		`${indent}${label}  ` +
			`${cyan(fmt(m.caloriesKcal, " kcal", 0))}  ` +
			`P:${fmt(m.proteinG, "g")}  ` +
			`C:${fmt(m.carbsG, "g")}  ` +
			`F:${fmt(m.fatG, "g")}  ` +
			`Fiber:${fmt(m.fiberG, "g")}`,
	);
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type FoodItem = {
	foodId?: mongoose.Types.ObjectId | null;
	foodName?: string;
	quantityG?: number | null;
	unit?: string;
	caloriesKcal?: number | null;
	proteinG?: number | null;
	carbsG?: number | null;
	fatG?: number | null;
	fiberG?: number | null;
};

type MealOption = {
	_id?: mongoose.Types.ObjectId;
	title?: string;
	isDefault?: boolean;
	foods?: FoodItem[];
	macros?: MacroRow;
};

type Meal = {
	mealType?: string;
	name?: string;
	recipeId?: mongoose.Types.ObjectId | null;
	timeOfDay?: string | null;
	notes?: string;
	items?: FoodItem[];
	options?: MealOption[];
	cookingDirections?: string[];
	prepTimeMinutes?: number | null;
};

type Day = {
	dayNumber?: number;
	meals?: Meal[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Counters for the diagnostics block
// ─────────────────────────────────────────────────────────────────────────────

type Diag = {
	userFound: boolean;
	activePlanFound: boolean;
	daysCount: number;
	mealsCount: number;
	recipesWithRef: number;
	totalItems: number;
	missingFoodRefs: number;
	missingRecipeRefs: number;
	mealsWithEmptyItems: number;
	mealsWithOptions: number;
	// layer tracing
	itemsFromPlanSnapshot: number;
	itemsFromRecipeCatalog: number;
	recipesResolvedFromCatalog: number;
	unresolvedMeals: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Print ingredient rows from a food-item array
// ─────────────────────────────────────────────────────────────────────────────

const printFoodItems = (
	items: FoodItem[],
	diag: Diag,
	source: "plan" | "catalog",
) => {
	if (!items || items.length === 0) return zeroMacros();
	const totals = zeroMacros();
	for (const item of items) {
		if (source === "plan") diag.itemsFromPlanSnapshot++;
		else diag.itemsFromRecipeCatalog++;
		if (!item.foodId) diag.missingFoodRefs++;
		const row: MacroRow = {
			caloriesKcal: item.caloriesKcal ?? 0,
			proteinG: item.proteinG ?? 0,
			carbsG: item.carbsG ?? 0,
			fatG: item.fatG ?? 0,
			fiberG: item.fiberG ?? 0,
		};
		console.log(
			`     • ${bold(item.foodName ?? dim("[unnamed]"))} | ` +
				`${fmt(item.quantityG, item.unit ?? "g", 0)} | ` +
				`${fmt(item.caloriesKcal, " kcal", 0)} | ` +
				`P:${fmt(item.proteinG, "g")} | ` +
				`C:${fmt(item.carbsG, "g")} | ` +
				`F:${fmt(item.fatG, "g")} | ` +
				`Fiber:${fmt(item.fiberG, "g")}` +
				(item.foodId ? "" : red("  ⚠ no foodId")),
		);
		Object.assign(totals, addMacros(totals, row));
	}
	return totals;
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolve ingredient details for a single meal
// ─────────────────────────────────────────────────────────────────────────────

const resolveMealIngredients = async (
	meal: Meal,
	diag: Diag,
): Promise<MacroRow> => {
	const mealLabel = `${meal.mealType ?? "?"} — ${meal.name ?? "[unnamed]"}`;

	// 1. Plan snapshot items[] (highest priority — real stored data)
	const hasDirectItems = (meal.items?.length ?? 0) > 0;
	const hasOptions = (meal.options?.length ?? 0) > 0;

	if (hasDirectItems) {
		console.log(
			`   ${yellow("▶")} Items from UserNutritionPlan snapshot (items[]):`,
		);
		const totals = printFoodItems(meal.items ?? [], diag, "plan");
		return totals;
	}

	// 2. Options (default option's foods)
	if (hasOptions) {
		diag.mealsWithOptions++;
		const opts = meal.options ?? [];
		const defaultOpt = opts.find((o) => o.isDefault) ?? opts[0];
		if (!defaultOpt) {
			console.log(
				`   ${red("✗ options[] present but all entries are empty.")}`,
			);
			return zeroMacros();
		}
		console.log(
			`   ${yellow("▶")} Items from default option: ${cyan(defaultOpt.title ?? "[no title]")} (options[]→foods[]):`,
		);
		const totals = printFoodItems(defaultOpt.foods ?? [], diag, "plan");
		return totals;
	}

	// 3. Fall back to Recipe catalog
	if (meal.recipeId) {
		diag.missingRecipeRefs++;
		console.log(
			`   ${red("⚠")} No items[] or options[] in plan snapshot.` +
				`\n   ${yellow("▶")} Falling back to Recipe catalog (recipeId: ${meal.recipeId}):`,
		);

		const ingredients = await RecipeIngredient.find({ recipeId: meal.recipeId })
			.sort({ sortOrder: 1 })
			.lean();

		if (ingredients.length === 0) {
			console.log(
				`     ${red("✗ No RecipeIngredient rows found in catalog either.")}`,
			);
			diag.unresolvedMeals.push(mealLabel);
			return zeroMacros();
		}

		diag.recipesResolvedFromCatalog++;
		const totals = zeroMacros();
		for (const ing of ingredients) {
			diag.itemsFromRecipeCatalog++;
			if (!ing.foodId) diag.missingFoodRefs++;
			const row: MacroRow = {
				caloriesKcal: ing.caloriesKcal ?? 0,
				proteinG: ing.proteinG ?? 0,
				carbsG: ing.carbsG ?? 0,
				fatG: ing.fatG ?? 0,
				fiberG: ing.fiberG ?? 0,
			};
			console.log(
				`     • ${bold(ing.rawIngredientName)} | ` +
					`${fmt(ing.quantity, ing.unit ?? "g", 0)} | ` +
					`${fmt(ing.caloriesKcal, " kcal", 0)} | ` +
					`P:${fmt(ing.proteinG, "g")} | ` +
					`C:${fmt(ing.carbsG, "g")} | ` +
					`F:${fmt(ing.fatG, "g")} | ` +
					`Fiber:${fmt(ing.fiberG, "g")}` +
					dim("  [catalog]") +
					(ing.foodId ? "" : red("  ⚠ no foodId")),
			);
			Object.assign(totals, addMacros(totals, row));
		}
		return totals;
	}

	// 4. Completely unresolved
	console.log(
		`   ${red("✗ No items, options, or recipeId. Ingredient data unavailable.")}`,
	);
	diag.unresolvedMeals.push(mealLabel);
	return zeroMacros();
};

// ─────────────────────────────────────────────────────────────────────────────
// Trace template snapshot (informational)
// ─────────────────────────────────────────────────────────────────────────────

const traceTemplateSnapshot = async (plan: { sourceTemplateId?: unknown }) => {
	if (!plan.sourceTemplateId) {
		console.log(dim("  No source template (ad-hoc plan)."));
		return;
	}
	const tmpl = await NutritionTemplate.findById(plan.sourceTemplateId).lean();
	if (!tmpl) {
		console.log(
			red(`  ⚠ Source template ${plan.sourceTemplateId} NOT FOUND in DB.`),
		);
		return;
	}
	const days = (tmpl.days ?? []) as Day[];
	let templateMealCount = 0;
	let templateItemCount = 0;
	for (const d of days) {
		for (const m of d.meals ?? []) {
			templateMealCount++;
			templateItemCount += m.items?.length ?? 0;
		}
	}
	console.log(
		`  Template: ${bold(tmpl.name)}  ` +
			`Days: ${days.length}  Meals: ${templateMealCount}  Items: ${templateItemCount}`,
	);
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	const email = process.argv[2] ?? "rahul@fitflix.in";
	console.log();
	console.log(bold(`Nutrition Hub Diagnostic`));
	console.log(dim(`User: ${email}`));
	console.log(hr());

	await connectDB();

	const diag: Diag = {
		userFound: false,
		activePlanFound: false,
		daysCount: 0,
		mealsCount: 0,
		recipesWithRef: 0,
		totalItems: 0,
		missingFoodRefs: 0,
		missingRecipeRefs: 0,
		mealsWithEmptyItems: 0,
		mealsWithOptions: 0,
		itemsFromPlanSnapshot: 0,
		itemsFromRecipeCatalog: 0,
		recipesResolvedFromCatalog: 0,
		unresolvedMeals: [],
	};

	// ── 1. User lookup ─────────────────────────────────────────────────────────
	const user = await User.findOne({ email })
		.select("_id username email")
		.lean();
	if (!user) {
		console.log(red(`✗ User not found: ${email}`));
		await mongoose.disconnect();
		process.exit(1);
	}
	diag.userFound = true;
	console.log(
		green(`✓ User found: ${user.username ?? "[no username]"} (${user._id})`),
	);

	// ── 2. Active plan ─────────────────────────────────────────────────────────
	const plan = await UserNutritionPlan.findOne({
		userId: user._id,
		status: NutritionPlanStatus.Active,
	})
		.sort({ createdAt: -1 })
		.lean();

	if (!plan) {
		// Check if any plans exist at all
		const allPlans = await UserNutritionPlan.find({ userId: user._id })
			.select("name status createdAt")
			.sort({ createdAt: -1 })
			.lean();

		if (allPlans.length === 0) {
			console.log(red(`✗ No UserNutritionPlan found for this user.`));
		} else {
			console.log(
				yellow(`⚠ No ACTIVE plan. Existing plans (${allPlans.length}):`),
			);
			for (const p of allPlans) {
				console.log(
					dim(`   • ${p.name}  status=${p.status}  created=${p.createdAt}`),
				);
			}
		}
		printDiag(diag);
		await mongoose.disconnect();
		process.exit(0);
	}

	diag.activePlanFound = true;
	console.log(green(`✓ Active plan: ${bold(plan.name)}`));
	console.log(
		dim(
			`  id=${plan._id}  goal=${plan.goal}  ` +
				`durationDays=${plan.durationDays}  ` +
				`start=${plan.startDate ?? "not set"}  ` +
				`sourceTemplate=${plan.sourceTemplateId ?? "none (ad-hoc)"}`,
		),
	);

	// ── 3. Template snapshot info ──────────────────────────────────────────────
	console.log();
	console.log(bold("Template snapshot:"));
	await traceTemplateSnapshot(plan);

	// ── 4. Plan targets ─────────────────────────────────────────────────────────
	console.log();
	console.log(bold("Plan Targets:"));
	console.log(
		`  Calories: ${cyan(fmt(plan.targetCaloriesKcal, " kcal", 0))}  ` +
			`Protein: ${fmt((plan.targetMacros as MacroRow)?.proteinG, "g")}  ` +
			`Carbs: ${fmt((plan.targetMacros as MacroRow)?.carbsG, "g")}  ` +
			`Fat: ${fmt((plan.targetMacros as MacroRow)?.fatG, "g")}  ` +
			`Fiber: ${fmt((plan.targetMacros as MacroRow)?.fiberG, "g")}`,
	);

	// ── 5. Days / Meals / Ingredients ─────────────────────────────────────────
	const days = (plan.days ?? []) as Day[];
	diag.daysCount = days.length;

	if (days.length === 0) {
		console.log();
		console.log(red(`✗ plan.days is empty — no meals to display.`));
		console.log(
			yellow(
				`  This means the UserNutritionPlan was assigned from a template that had empty days[],\n`,
			) + yellow(`  or was created as ad-hoc with no days provided.`),
		);
		printDiag(diag);
		await mongoose.disconnect();
		process.exit(0);
	}

	const planTotals = zeroMacros();

	for (const day of days) {
		const meals = (day.meals ?? []) as Meal[];
		diag.mealsCount += meals.length;
		const dayTotals = zeroMacros();

		console.log();
		console.log(hr("═"));
		console.log(bold(`  DAY ${day.dayNumber ?? "?"}`));
		console.log(hr("═"));

		if (meals.length === 0) {
			console.log(red(`  No meals on this day.`));
			continue;
		}

		for (const meal of meals) {
			console.log();
			console.log(
				`  ${bold(meal.mealType ?? "[type?]")}  ${cyan(meal.name ?? "[unnamed]")}` +
					(meal.timeOfDay ? dim(`  @${meal.timeOfDay}`) : "") +
					(meal.recipeId ? dim(`  [recipeId: ${meal.recipeId}]`) : ""),
			);

			if (meal.recipeId) diag.recipesWithRef++;

			const hasItems = (meal.items?.length ?? 0) > 0;
			const hasOptions = (meal.options?.length ?? 0) > 0;
			if (!hasItems && !hasOptions) diag.mealsWithEmptyItems++;

			console.log(`   ${dim("Ingredients:")}`);
			const mealTotals = await resolveMealIngredients(meal, diag);

			console.log();
			console.log(`   ${dim("Recipe Totals:")}`);
			printMacroLine("", mealTotals, "   ");

			if (meal.cookingDirections && meal.cookingDirections.length > 0) {
				console.log(`   ${dim("Cooking:")}`);
				for (const step of meal.cookingDirections) {
					console.log(`     ${dim("→")} ${step}`);
				}
			}
			if (meal.prepTimeMinutes) {
				console.log(`   ${dim(`Prep time: ${meal.prepTimeMinutes} min`)}`);
			}

			Object.assign(dayTotals, addMacros(dayTotals, mealTotals));
		}

		console.log();
		console.log(hr("─"));
		console.log(`  ${bold("Day Totals:")}`);
		printMacroLine("", dayTotals, "  ");
		Object.assign(planTotals, addMacros(planTotals, dayTotals));
	}

	// ── 6. Plan totals ─────────────────────────────────────────────────────────
	console.log();
	console.log(hr("═"));
	console.log(bold("  PLAN TOTALS (across all days)"));
	console.log(hr("═"));
	printMacroLine("", planTotals, "  ");

	if (days.length > 1) {
		const perDay: MacroRow = {
			caloriesKcal: (planTotals.caloriesKcal ?? 0) / days.length,
			proteinG: (planTotals.proteinG ?? 0) / days.length,
			carbsG: (planTotals.carbsG ?? 0) / days.length,
			fatG: (planTotals.fatG ?? 0) / days.length,
			fiberG: (planTotals.fiberG ?? 0) / days.length,
		};
		console.log(`  ${dim("Average per day:")}`);
		printMacroLine("", perDay, "  ");
	}

	// ── 7. Global catalog counts (for reference) ───────────────────────────────
	console.log();
	console.log(hr());
	console.log(bold("Catalog inventory (global — not scoped to plan):"));
	const [categoryCount, recipeCount, ingredientCount, foodCount] =
		await Promise.all([
			MealPlanCategory.countDocuments(),
			Recipe.countDocuments({ isActive: true }),
			RecipeIngredient.countDocuments(),
			NutritionFood.countDocuments({ isActive: true }),
		]);
	const nullFoodIdCount = await RecipeIngredient.countDocuments({
		foodId: null,
	});
	console.log(`  Categories:            ${categoryCount}`);
	console.log(`  Recipes (active):      ${recipeCount}`);
	console.log(`  RecipeIngredients:     ${ingredientCount}`);
	console.log(`  NutritionFoods:        ${foodCount}`);
	console.log(
		`  RecipeIngredients with null foodId: ` +
			(nullFoodIdCount > 0 ? red(String(nullFoodIdCount)) : green("0")),
	);

	// ── 8. Diagnostics block ───────────────────────────────────────────────────
	diag.totalItems = diag.itemsFromPlanSnapshot + diag.itemsFromRecipeCatalog;
	printDiag(diag);

	await mongoose.disconnect();
}

function printDiag(diag: Diag) {
	console.log();
	console.log(hr("═"));
	console.log(bold("  DATABASE DIAGNOSTICS"));
	console.log(hr("═"));

	const tick = (v: boolean) => (v ? green("✓") : red("✗"));

	console.log(`  ${tick(diag.userFound)} User found`);
	console.log(`  ${tick(diag.activePlanFound)} Active UserNutritionPlan found`);
	console.log(`  Days count:                     ${diag.daysCount}`);
	console.log(`  Meals count (total):            ${diag.mealsCount}`);
	console.log(`  Meals with recipeId ref:        ${diag.recipesWithRef}`);
	console.log(
		`  Meals with empty items[]:       ${diag.mealsWithEmptyItems > 0 ? yellow(String(diag.mealsWithEmptyItems)) : "0"}`,
	);
	console.log(`  Meals with options[]:           ${diag.mealsWithOptions}`);
	console.log();
	console.log(`  Total ingredient rows shown:    ${diag.totalItems}`);
	console.log(
		`    ↳ from plan snapshot (items): ${diag.itemsFromPlanSnapshot}`,
	);
	console.log(
		`    ↳ from Recipe catalog fallback: ${diag.itemsFromRecipeCatalog}`,
	);
	console.log(
		`  Missing foodId refs (items):    ` +
			(diag.missingFoodRefs > 0
				? red(String(diag.missingFoodRefs))
				: green("0")),
	);
	console.log(
		`  Meals using catalog fallback:   ` +
			(diag.missingRecipeRefs > 0
				? yellow(String(diag.missingRecipeRefs))
				: green("0")),
	);
	console.log(
		`  Recipes resolved from catalog:  ${diag.recipesResolvedFromCatalog}`,
	);

	if (diag.unresolvedMeals.length > 0) {
		console.log();
		console.log(
			red(`  ✗ Fully unresolved meals (no items, options, or catalog data):`),
		);
		for (const m of diag.unresolvedMeals) {
			console.log(red(`    • ${m}`));
		}
	}

	// Trace: where is ingredient data lost?
	if (diag.mealsWithEmptyItems > 0 && diag.itemsFromPlanSnapshot === 0) {
		console.log();
		console.log(yellow("  Data flow gap trace:"));
		console.log(
			yellow(
				"  Recipe → RecipeIngredient [data EXISTS in catalog]\n" +
					"  RecipeIngredient → NutritionTemplate.meals[].items[]  [MISSING — template meals have empty items[]]\n" +
					"  NutritionTemplate → UserNutritionPlan snapshot         [MISSING — plan days[] have empty meals[].items[]]\n" +
					"  UserNutritionPlan → Flutter Hub                        [BLOCKED — nothing to display]\n" +
					"\n" +
					"  Fix: build a bridge that converts RecipeIngredient rows into mealFoodItemSchema\n" +
					"  entries and populates templateMealSchema.items[] when creating the template.",
			),
		);
	}
	console.log(hr("═"));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
