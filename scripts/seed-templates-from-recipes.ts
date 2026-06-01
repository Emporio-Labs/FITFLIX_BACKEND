/**
 * scripts/seed-templates-from-recipes.ts
 *
 * Idempotent seed — creates one NutritionTemplate per MealPlanCategory
 * from imported Recipe + RecipeIngredient data. Safe to re-run: existing
 * templates with the same name are skipped.
 *
 * Usage:
 *   bun run scripts/seed-templates-from-recipes.ts [--dry-run] [--admin-email=admin@fitflix.in]
 *
 * Flags:
 *   --dry-run              Print what would be created without writing to DB
 *   --admin-email=<email>  Email of the User to set as template createdBy
 *                          (default: admin@fitflix.in)
 *
 * Env vars required: MONGODB_URL
 */

import { config } from "dotenv";
import mongoose from "mongoose";

import connectDB from "../src/utils/db";
import User from "../src/models/User";
import Admin from "../src/models/Admin";
import MealPlanCategory from "../src/models/MealPlanCategory";
import NutritionTemplate from "../src/models/nutrition-template.model";
import Recipe from "../src/models/Recipe";
import { NutritionGoal } from "../src/models/Enums";
import {
	buildTemplateDaysFromCategory,
} from "../src/services/nutrition/nutrition-recipe.service";
import { sumMacros } from "../src/services/nutrition/nutrition-macro.util";

config();

// ─────────────────────────────────────────────────────────────────────────────
// CLI arg parsing
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const adminEmailArg = args
	.find((a) => a.startsWith("--admin-email="))
	?.split("=")[1];
const adminEmail = adminEmailArg ?? "admin@fitflix.in";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────────────────────
// Resolve admin/nutritionist user for createdBy
// ─────────────────────────────────────────────────────────────────────────────

async function resolveCreatedBy(): Promise<mongoose.Types.ObjectId> {
	// Try User collection first (nutritionist or admin role)
	const user = await User.findOne({ email: adminEmail })
		.select("_id role email")
		.lean();
	if (user) {
		console.log(green(`✓ Using User account: ${adminEmail} (${user._id})`));
		return user._id as mongoose.Types.ObjectId;
	}

	// Fall back to Admin collection — NutritionTemplate.createdBy is a User ref
	// so if we only have an Admin doc, we need a User with admin role.
	const admin = await Admin.findOne({ email: adminEmail }).select("_id email").lean();
	if (admin) {
		console.log(yellow(`⚠ Found Admin account but NutritionTemplate.createdBy requires a User ref.`));
		console.log(yellow(`  Searching for any User with admin role as fallback…`));
	}

	// Last resort: use any admin-role User
	const fallback = await User.findOne({ role: "admin" } as Record<string, unknown>)
		.select("_id email")
		.lean();
	if (fallback) {
		console.log(yellow(`⚠ Using fallback admin User: ${(fallback as { email: string }).email} (${fallback._id})`));
		return fallback._id as mongoose.Types.ObjectId;
	}

	// Use any user at all (template seeding should not fail on this)
	const anyUser = await User.findOne().select("_id email").lean();
	if (anyUser) {
		console.log(yellow(`⚠ No admin User found. Using first available User: ${(anyUser as { email: string }).email} (${anyUser._id})`));
		return anyUser._id as mongoose.Types.ObjectId;
	}

	throw new Error(
		`No User found in DB. Cannot set createdBy for templates.\n` +
		`Create a user first: bun run scripts/create-admin.ts`,
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log();
	console.log(bold("Seed NutritionTemplates from Recipe catalog"));
	if (isDryRun) console.log(yellow("DRY RUN — no writes will occur"));
	console.log();

	await connectDB();

	const createdBy = await resolveCreatedBy();

	const categories = await MealPlanCategory.find().sort({ sortOrder: 1 }).lean();
	if (categories.length === 0) {
		console.log(red("✗ No MealPlanCategory documents found. Run the Excel import first:"));
		console.log(dim("  bun run scripts/import-meal-plan.ts"));
		await mongoose.disconnect();
		process.exit(1);
	}

	console.log(`Found ${categories.length} categories.\n`);

	const summary: Array<{
		category: string;
		status: "created" | "skipped" | "error";
		templateId?: string;
		recipeCount: number;
		skippedIngredients: number;
		error?: string;
	}> = [];

	for (const category of categories) {
		const templateName = `${category.name} Starter Template`;
		const recipeCount = await Recipe.countDocuments({
			categoryId: category._id,
			isActive: true,
		});

		process.stdout.write(`  ${bold(category.name)}  (${recipeCount} recipes) … `);

		// Idempotency check
		const existing = await NutritionTemplate.findOne({ name: templateName })
			.select("_id")
			.lean();
		if (existing) {
			console.log(dim(`skipped (template already exists: ${existing._id})`));
			summary.push({
				category: category.name,
				status: "skipped",
				templateId: existing._id.toString(),
				recipeCount,
				skippedIngredients: 0,
			});
			continue;
		}

		if (recipeCount === 0) {
			console.log(yellow("no recipes — skipped"));
			summary.push({
				category: category.name,
				status: "skipped",
				recipeCount: 0,
				skippedIngredients: 0,
				error: "No active recipes",
			});
			continue;
		}

		try {
			const { days, skippedIngredients, recipeCount: built } =
				await buildTemplateDaysFromCategory(
					(category._id as mongoose.Types.ObjectId).toString(),
				);

			const allItems = (days[0]?.meals ?? []).flatMap((m) => m.items);
			const totals = sumMacros(allItems);

			if (!isDryRun) {
				const template = await NutritionTemplate.create({
					name: templateName,
					description: `Auto-generated from ${category.name} recipe catalog`,
					createdBy,
					goal: NutritionGoal.Maintenance,
					status: "Draft",
					tags: [category.slug],
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

				console.log(green(`created ${template._id}`) +
					dim(`  recipes=${built}  skipped=${skippedIngredients.length}`));
				summary.push({
					category: category.name,
					status: "created",
					templateId: template._id.toString(),
					recipeCount: built,
					skippedIngredients: skippedIngredients.length,
				});
			} else {
				console.log(yellow(`[dry-run] would create`) +
					dim(`  recipes=${built}  skipped=${skippedIngredients.length}`));
				if (skippedIngredients.length > 0) {
					console.log(dim(`    Skipped ingredients: ${skippedIngredients.join(", ")}`));
				}
				summary.push({
					category: category.name,
					status: "created",
					recipeCount: built,
					skippedIngredients: skippedIngredients.length,
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.log(red(`error: ${msg}`));
			summary.push({
				category: category.name,
				status: "error",
				recipeCount,
				skippedIngredients: 0,
				error: msg,
			});
		}
	}

	// ── Summary table ──────────────────────────────────────────────────────────
	console.log();
	console.log(bold("Summary"));
	console.log("─".repeat(72));
	console.log(
		`${"Category".padEnd(24)} ${"Status".padEnd(10)} ${"Recipes".padEnd(10)} ${"Skipped ings".padEnd(14)} Template ID`,
	);
	console.log("─".repeat(72));
	for (const row of summary) {
		const status =
			row.status === "created"
				? green("created")
				: row.status === "skipped"
					? dim("skipped")
					: red("error  ");
		console.log(
			`${row.category.padEnd(24)} ${status.padEnd(19)} ${String(row.recipeCount).padEnd(10)} ${String(row.skippedIngredients).padEnd(14)} ${row.templateId ?? row.error ?? "—"}`,
		);
	}
	console.log("─".repeat(72));
	const created = summary.filter((r) => r.status === "created").length;
	const skipped = summary.filter((r) => r.status === "skipped").length;
	console.log(`Created: ${created}  Skipped: ${skipped}  Errors: ${summary.filter((r) => r.status === "error").length}`);

	if (created > 0 && !isDryRun) {
		console.log();
		console.log(bold("Next steps:"));
		console.log(
			"  1. Assign a template to a user:\n" +
			"     POST /nutrition/templates/:id/assign  { userId, startDate }\n" +
			"  2. Verify the plan has ingredient-level data:\n" +
			"     bun run scripts/diagnose-nutrition-hub.ts <email>",
		);
	}

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
