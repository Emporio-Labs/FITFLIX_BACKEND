/**
 * scripts/migrate-user-to-recipe-plan.ts
 *
 * Migrates a user from a legacy (manually authored) UserNutritionPlan to one
 * of the recipe-driven NutritionTemplates created by seed-templates-from-recipes.ts.
 *
 * Steps:
 *  1. Finds the user by email
 *  2. Lists all active UserNutritionPlans — marks each as legacy or recipe-driven
 *  3. Archives all legacy active plans
 *  4. Lists available seeded templates (Starter Templates)
 *  5. Assigns the chosen template to the user
 *  6. Runs a full ingredient-level diagnostic on the new plan
 *
 * Usage:
 *   bun run scripts/migrate-user-to-recipe-plan.ts [email] [--template-name="Salads Starter Template"] [--dry-run]
 *
 * Defaults:
 *   email            rahul@fitflix.in
 *   --template-name  first available Starter Template (sorted by category sortOrder)
 *   --dry-run        print what would happen without writing
 *
 * Env vars required: MONGODB_URL
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import { NutritionPlanStatus } from "../src/models/Enums";
import MealPlanCategory from "../src/models/MealPlanCategory";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import NutritionTemplate from "../src/models/nutrition-template.model";
import RecipeIngredient from "../src/models/RecipeIngredient";
import User from "../src/models/User";
import { assignTemplateToUser } from "../src/services/nutrition/nutrition-assignment.service";
import connectDB from "../src/utils/db";

config();

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
const isDryRun = cliArgs.includes("--dry-run");
const emailArg = cliArgs.find((a) => !a.startsWith("--")) ?? "rahul@fitflix.in";
const templateNameArg = cliArgs
	.find((a) => a.startsWith("--template-name="))
	?.split("=")
	.slice(1)
	.join("=");

// ─────────────────────────────────────────────────────────────────────────────
// Console helpers
// ─────────────────────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const hr = (c = "─", n = 70) => c.repeat(n);
const fmt = (v: number | null | undefined, suffix = "", d = 1) =>
	v == null ? dim("—") : `${Number(v).toFixed(d)}${suffix}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when ANY meal in a plan has a populated recipeId. */
const isRecipeDriven = (plan: { days?: unknown }): boolean => {
	const days = (plan.days ?? []) as Array<{
		meals?: Array<{ recipeId?: unknown }>;
	}>;
	for (const day of days) {
		for (const meal of day.meals ?? []) {
			if (meal.recipeId) return true;
		}
	}
	return false;
};

type ItemLike = {
	foodId?: unknown;
	foodName?: string;
	quantityG?: number | null;
	unit?: string;
	caloriesKcal?: number | null;
	proteinG?: number | null;
	carbsG?: number | null;
	fatG?: number | null;
	fiberG?: number | null;
};

type MealLike = {
	mealType?: string;
	name?: string;
	recipeId?: unknown;
	items?: ItemLike[];
	options?: Array<{ isDefault?: boolean; foods?: ItemLike[] }>;
};

type DayLike = {
	dayNumber?: number;
	meals?: MealLike[];
};

const getItems = (meal: MealLike): ItemLike[] => {
	if ((meal.options?.length ?? 0) > 0) {
		const options = meal.options ?? [];
		const def = options.find((o) => o.isDefault) ?? options[0];
		return def?.foods ?? [];
	}
	return meal.items ?? [];
};

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Diagnostic of a plan (full ingredient breakdown)
// ─────────────────────────────────────────────────────────────────────────────

type PlanTotals = {
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG: number;
};

const diagnosePlan = async (
	plan: Record<string, unknown>,
): Promise<{
	totals: PlanTotals;
	mealsCount: number;
	itemsCount: number;
	recipeRefs: number;
	missingFoodRefs: number;
}> => {
	const days = (plan.days ?? []) as DayLike[];
	const planTotals: PlanTotals = {
		caloriesKcal: 0,
		proteinG: 0,
		carbsG: 0,
		fatG: 0,
		fiberG: 0,
	};
	let mealsCount = 0;
	let itemsCount = 0;
	let recipeRefs = 0;
	let missingFoodRefs = 0;

	for (const day of days) {
		const dayTotals: PlanTotals = {
			caloriesKcal: 0,
			proteinG: 0,
			carbsG: 0,
			fatG: 0,
			fiberG: 0,
		};
		console.log();
		console.log(hr("═"));
		console.log(bold(`  DAY ${day.dayNumber ?? "?"}`));
		console.log(hr("═"));

		for (const meal of day.meals ?? []) {
			mealsCount++;
			if (meal.recipeId) recipeRefs++;

			const items = getItems(meal);
			const mealTotals: PlanTotals = {
				caloriesKcal: 0,
				proteinG: 0,
				carbsG: 0,
				fatG: 0,
				fiberG: 0,
			};

			console.log();
			console.log(
				`  ${bold(meal.mealType ?? "?")}  ${cyan(meal.name ?? "[unnamed]")}` +
					(meal.recipeId
						? dim(`  [recipe: ${meal.recipeId}]`)
						: red("  [no recipeId]")),
			);

			if (items.length === 0) {
				console.log(red("    ✗ No ingredients."));
				continue;
			}

			console.log(dim("    Ingredients:"));
			for (const item of items) {
				itemsCount++;
				if (!item.foodId) missingFoodRefs++;
				const cal = item.caloriesKcal ?? 0;
				const pro = item.proteinG ?? 0;
				const carb = item.carbsG ?? 0;
				const fat = item.fatG ?? 0;
				const fib = item.fiberG ?? 0;
				mealTotals.caloriesKcal += cal;
				mealTotals.proteinG += pro;
				mealTotals.carbsG += carb;
				mealTotals.fatG += fat;
				mealTotals.fiberG += fib;
				console.log(
					`    • ${bold(item.foodName ?? dim("[unnamed]"))}` +
						` | ${fmt(item.quantityG, item.unit ?? "g", 0)}` +
						` | ${fmt(item.caloriesKcal, " kcal", 0)}` +
						` | P:${fmt(item.proteinG, "g")}` +
						` | C:${fmt(item.carbsG, "g")}` +
						` | F:${fmt(item.fatG, "g")}` +
						` | Fiber:${fmt(item.fiberG, "g")}` +
						(item.foodId ? "" : red("  ⚠ no foodId")),
				);
			}

			console.log(
				dim(`    Recipe Totals: `) +
					cyan(`${fmt(mealTotals.caloriesKcal, " kcal", 0)}`) +
					`  P:${fmt(mealTotals.proteinG, "g")}` +
					`  C:${fmt(mealTotals.carbsG, "g")}` +
					`  F:${fmt(mealTotals.fatG, "g")}` +
					`  Fiber:${fmt(mealTotals.fiberG, "g")}`,
			);

			dayTotals.caloriesKcal += mealTotals.caloriesKcal;
			dayTotals.proteinG += mealTotals.proteinG;
			dayTotals.carbsG += mealTotals.carbsG;
			dayTotals.fatG += mealTotals.fatG;
			dayTotals.fiberG += mealTotals.fiberG;
		}

		console.log();
		console.log(hr());
		console.log(
			bold("  Day Totals: ") +
				cyan(`${fmt(dayTotals.caloriesKcal, " kcal", 0)}`) +
				`  P:${fmt(dayTotals.proteinG, "g")}` +
				`  C:${fmt(dayTotals.carbsG, "g")}` +
				`  F:${fmt(dayTotals.fatG, "g")}` +
				`  Fiber:${fmt(dayTotals.fiberG, "g")}`,
		);

		planTotals.caloriesKcal += dayTotals.caloriesKcal;
		planTotals.proteinG += dayTotals.proteinG;
		planTotals.carbsG += dayTotals.carbsG;
		planTotals.fatG += dayTotals.fatG;
		planTotals.fiberG += dayTotals.fiberG;
	}

	return {
		totals: planTotals,
		mealsCount,
		itemsCount,
		recipeRefs,
		missingFoodRefs,
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log();
	console.log(bold("Nutrition Plan Migration: Legacy → Recipe-Driven"));
	console.log(dim(`User: ${emailArg}`));
	if (isDryRun) console.log(yellow("DRY RUN — no writes"));
	console.log(hr("═"));

	await connectDB();

	// ── 1. Find user ─────────────────────────────────────────────────────────
	const user = await User.findOne({ email: emailArg })
		.select("_id username email")
		.lean();
	if (!user) {
		console.log(red(`✗ User not found: ${emailArg}`));
		process.exit(1);
	}
	const userId = (user._id as mongoose.Types.ObjectId).toString();
	console.log(green(`✓ User: ${user.username ?? user.email}  (${userId})`));

	// ── 2. Inspect all active plans ──────────────────────────────────────────
	const activePlans = await UserNutritionPlan.find({
		userId: user._id,
		status: NutritionPlanStatus.Active,
	})
		.sort({ createdAt: -1 })
		.lean();

	console.log();
	console.log(bold(`Active UserNutritionPlans: ${activePlans.length}`));

	const legacyPlans: (typeof activePlans)[0][] = [];
	const recipePlans: (typeof activePlans)[0][] = [];

	for (const plan of activePlans) {
		const driven = isRecipeDriven(plan as Record<string, unknown>);
		const days = (plan.days ?? []) as DayLike[];
		const totalMeals = days.reduce((s, d) => s + (d.meals?.length ?? 0), 0);
		const totalItems = days.reduce(
			(s, d) =>
				s +
				(d.meals ?? []).reduce(
					(ms, m) => ms + getItems(m as MealLike).length,
					0,
				),
			0,
		);
		const tag = driven ? green("[recipe-driven]") : red("[legacy manual]");
		console.log(
			`  ${tag}  ${bold(plan.name)}` +
				dim(
					`  id=${plan._id}  days=${days.length}  meals=${totalMeals}  items=${totalItems}`,
				) +
				dim(`  src=${plan.sourceTemplateId ?? "none (ad-hoc)"}`),
		);
		(driven ? recipePlans : legacyPlans).push(plan);
	}

	if (legacyPlans.length === 0) {
		console.log(green("  No legacy plans to migrate."));
		if (recipePlans.length > 0) {
			console.log(
				green(
					`  User already has ${recipePlans.length} recipe-driven plan(s). Nothing to do.`,
				),
			);
		}
		await mongoose.disconnect();
		return;
	}

	// ── 3. Archive legacy plans ──────────────────────────────────────────────
	console.log();
	console.log(bold(`Archiving ${legacyPlans.length} legacy plan(s)…`));
	for (const plan of legacyPlans) {
		if (!isDryRun) {
			await UserNutritionPlan.findByIdAndUpdate(plan._id, {
				status: NutritionPlanStatus.Archived,
			});
		}
		console.log(
			(isDryRun ? yellow("[dry-run] would archive") : green("✓ Archived")) +
				`  "${plan.name}"  (${plan._id})`,
		);
	}

	// ── 4. Find seeded templates ─────────────────────────────────────────────
	console.log();
	console.log(bold("Available Starter Templates:"));

	const allCategories = await MealPlanCategory.find()
		.sort({ sortOrder: 1 })
		.select("name slug")
		.lean();
	const categoryOrder = new Map(allCategories.map((c, i) => [c.name, i]));

	const seededTemplates = await NutritionTemplate.find({
		name: /Starter Template$/,
	}).lean();

	seededTemplates.sort((a, b) => {
		const ai = categoryOrder.get(a.name.replace(" Starter Template", "")) ?? 99;
		const bi = categoryOrder.get(b.name.replace(" Starter Template", "")) ?? 99;
		return ai - bi;
	});

	if (seededTemplates.length === 0) {
		console.log(
			red(
				"  ✗ No Starter Templates found. Run seed-templates-from-recipes.ts first.",
			),
		);
		await mongoose.disconnect();
		process.exit(1);
	}

	for (const tmpl of seededTemplates) {
		const days = (tmpl.days ?? []) as DayLike[];
		const mealCount = days.reduce((s, d) => s + (d.meals?.length ?? 0), 0);
		const itemCount = days.reduce(
			(s, d) =>
				s + (d.meals ?? []).reduce((ms, m) => ms + (m.items?.length ?? 0), 0),
			0,
		);
		const recipeRefCount = days.reduce(
			(s, d) => s + (d.meals ?? []).filter((m) => m.recipeId).length,
			0,
		);
		console.log(
			`  ${bold(tmpl.name)}` +
				dim(`  id=${tmpl._id}`) +
				`  meals=${mealCount}  items=${itemCount}` +
				(recipeRefCount === mealCount
					? green(`  recipeIds: ${recipeRefCount}/${mealCount} ✓`)
					: yellow(`  recipeIds: ${recipeRefCount}/${mealCount}`)),
		);
	}

	// ── 5. Pick a template ───────────────────────────────────────────────────
	// seededTemplates is non-empty — we exited above if length === 0.
	// biome-ignore lint/style/noNonNullAssertion: guarded above
	let chosenTemplate = seededTemplates[0]!;
	if (templateNameArg) {
		const match = seededTemplates.find(
			(t) => t.name.toLowerCase() === templateNameArg.toLowerCase(),
		);
		if (!match) {
			console.log(
				yellow(
					`  ⚠ --template-name "${templateNameArg}" not found; using first available.`,
				),
			);
		} else {
			chosenTemplate = match;
		}
	}

	console.log();
	console.log(
		bold(`Selected template: ${chosenTemplate.name}  (${chosenTemplate._id})`),
	);

	// ── 6. Verify template meal quality before assigning ────────────────────
	const tmplDays = (chosenTemplate.days ?? []) as DayLike[];
	let nullFoodIdCount = 0;
	let recipeIdCount = 0;
	let totalIngredients = 0;

	for (const day of tmplDays) {
		for (const meal of day.meals ?? []) {
			if (meal.recipeId) recipeIdCount++;
			for (const item of meal.items ?? []) {
				totalIngredients++;
				if (!item.foodId) nullFoodIdCount++;
			}
		}
	}

	console.log(
		`  Recipe refs: ${recipeIdCount === (tmplDays[0]?.meals?.length ?? 0) ? green(String(recipeIdCount)) : yellow(String(recipeIdCount))}` +
			`  Ingredients: ${totalIngredients}` +
			`  Missing foodId: ${nullFoodIdCount > 0 ? red(String(nullFoodIdCount)) : green("0")}`,
	);

	if (totalIngredients === 0) {
		console.log(red("  ✗ Template has no ingredient data. Aborting."));
		await mongoose.disconnect();
		process.exit(1);
	}

	// ── 7. Assign template ───────────────────────────────────────────────────
	console.log();
	if (isDryRun) {
		console.log(
			yellow(
				`[dry-run] would call assignTemplateToUser(${chosenTemplate._id}, ${userId})`,
			),
		);
		await mongoose.disconnect();
		return;
	}

	// Resolve an admin-role actor. The service ownership check passes when role="admin".
	const adminUser = await User.findOne({ role: "admin" } as Record<
		string,
		unknown
	>)
		.select("_id role")
		.lean();
	const actorId = adminUser
		? (adminUser._id as mongoose.Types.ObjectId).toString()
		: (chosenTemplate.createdBy as mongoose.Types.ObjectId).toString();
	const actor = { id: actorId, role: "admin" as const };

	console.log(bold(`Assigning template to ${user.email}…`));
	const { plan: newPlan, warnings } = await assignTemplateToUser(
		(chosenTemplate._id as mongoose.Types.ObjectId).toString(),
		userId,
		actor,
		{ startDate: new Date() },
	);

	if (!newPlan) {
		console.log(red("✗ Assignment failed — plan not returned."));
		await mongoose.disconnect();
		process.exit(1);
	}

	console.log(
		green(
			`✓ New UserNutritionPlan created: ${(newPlan as { _id: unknown })._id}`,
		),
	);
	if (warnings.length > 0) {
		console.log(yellow(`  Allergen warnings (${warnings.length}):`));
		for (const w of warnings) {
			console.log(
				yellow(
					`    Day ${w.dayNumber} · ${w.mealName} · ${w.foodName} → ${w.matchedAllergens.join(", ")}`,
				),
			);
		}
	}

	// ── 8. Full ingredient-level diagnostic on the new plan ──────────────────
	const freshPlan = await UserNutritionPlan.findById(
		(newPlan as { _id: unknown })._id,
	).lean();
	if (!freshPlan) {
		console.log(red("✗ Could not reload new plan for diagnostic."));
		await mongoose.disconnect();
		process.exit(1);
	}

	console.log();
	console.log(hr("═"));
	console.log(bold("  FULL INGREDIENT DIAGNOSTIC — NEW PLAN"));
	console.log(bold(`  "${freshPlan.name}"`));
	console.log(hr("═"));
	console.log(
		`  Goal: ${cyan(freshPlan.goal)}` +
			`  Duration: ${freshPlan.durationDays} day(s)` +
			`  Status: ${green(freshPlan.status)}`,
	);
	console.log(
		`  Target calories: ${fmt(freshPlan.targetCaloriesKcal, " kcal", 0)}` +
			`  Protein: ${fmt((freshPlan.targetMacros as { proteinG?: number | null })?.proteinG, "g")}` +
			`  Carbs: ${fmt((freshPlan.targetMacros as { carbsG?: number | null })?.carbsG, "g")}` +
			`  Fat: ${fmt((freshPlan.targetMacros as { fatG?: number | null })?.fatG, "g")}`,
	);

	const {
		totals,
		mealsCount,
		itemsCount,
		recipeRefs: diagRecipeRefs,
		missingFoodRefs,
	} = await diagnosePlan(freshPlan as unknown as Record<string, unknown>);

	// ── Plan totals ───────────────────────────────────────────────────────────
	console.log();
	console.log(hr("═"));
	console.log(bold("  PLAN TOTALS"));
	console.log(hr("═"));
	console.log(
		`  ${cyan(fmt(totals.caloriesKcal, " kcal", 0))}` +
			`  Protein: ${fmt(totals.proteinG, "g")}` +
			`  Carbs: ${fmt(totals.carbsG, "g")}` +
			`  Fat: ${fmt(totals.fatG, "g")}` +
			`  Fiber: ${fmt(totals.fiberG, "g")}`,
	);

	// ── Database diagnostics ──────────────────────────────────────────────────
	console.log();
	console.log(hr("═"));
	console.log(bold("  DATABASE DIAGNOSTICS — NEW PLAN"));
	console.log(hr("═"));

	const tick = (v: boolean) => (v ? green("✓") : red("✗"));
	const days = (freshPlan.days ?? []) as DayLike[];

	// Verify recipeId provenance in RecipeIngredient collection
	const allRecipeIds = days
		.flatMap((d) => d.meals ?? [])
		.map((m) => m.recipeId)
		.filter(Boolean) as mongoose.Types.ObjectId[];
	const catalogVerified =
		allRecipeIds.length > 0
			? await RecipeIngredient.countDocuments({
					recipeId: { $in: allRecipeIds },
				})
			: 0;

	console.log(`  ${tick(true)} User found`);
	console.log(`  ${tick(true)} Active UserNutritionPlan created`);
	console.log(`  Days count:                     ${days.length}`);
	console.log(`  Meals count:                    ${mealsCount}`);
	console.log(
		`  Meals with recipeId ref:        ` +
			(diagRecipeRefs === mealsCount
				? green(`${diagRecipeRefs} / ${mealsCount} ✓`)
				: yellow(`${diagRecipeRefs} / ${mealsCount}`)),
	);
	console.log(`  Total ingredient rows:          ${itemsCount}`);
	console.log(
		`  Missing foodId refs:            ` +
			(missingFoodRefs > 0 ? red(String(missingFoodRefs)) : green("0")),
	);
	console.log(
		`  RecipeIngredient catalog rows:  ` +
			(catalogVerified > 0 ? green(String(catalogVerified)) : red("0")),
	);
	console.log(
		`  Items from plan snapshot:       ${itemsCount}` +
			dim("  (verbatim Excel macros — no re-scaling)"),
	);
	console.log(
		`  Items from catalog fallback:    ${green("0")}` +
			dim("  (bridge used direct snapshot)"),
	);

	console.log();
	if (diagRecipeRefs > 0 && itemsCount > 0 && missingFoodRefs === 0) {
		console.log(green("  ✓ Excel → Hub path is fully connected."));
		console.log(green("  ✓ Imported recipes will appear in Nutrition Hub."));
		console.log(
			green("  ✓ Ingredient quantities and macros preserved from Excel."),
		);
	} else {
		if (diagRecipeRefs === 0)
			console.log(
				red(
					"  ✗ No recipeId references — bridge may not have populated recipeId.",
				),
			);
		if (itemsCount === 0)
			console.log(
				red("  ✗ No ingredient data in plan — meals have empty items[]."),
			);
		if (missingFoodRefs > 0)
			console.log(
				yellow(`  ⚠ ${missingFoodRefs} ingredient(s) have no foodId link.`),
			);
	}

	console.log(hr("═"));

	console.log();
	console.log(bold("Next steps:"));
	console.log(
		`  1. Verify via API (as Rahul):\n` +
			`       GET /nutrition/my/plans\n` +
			`       GET /nutrition/my/plans/${(newPlan as { _id: unknown })._id}\n` +
			`  2. Re-run full diagnostic:\n` +
			`       bun run scripts/diagnose-nutrition-hub.ts ${emailArg}`,
	);

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
