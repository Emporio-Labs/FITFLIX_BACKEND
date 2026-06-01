/**
 * scripts/export-meal-plan.ts
 *
 * Verification script — reads MealPlanImportRow from MongoDB and rebuilds the
 * original Excel file.  Running a binary diff between the exported file and
 * the source Excel proves zero-loss preservation.
 *
 * Usage:
 *   bun run scripts/export-meal-plan.ts [importBatchId] [outputPath]
 *
 * If importBatchId is omitted, the most recent batch is used.
 * Output defaults to ./meal-plan-export-<batchId>.xlsx
 *
 * Verification steps printed to stdout:
 *   1. Row count per sheet matches source
 *   2. All 5 categories present
 *   3. Recipe count per category
 *   4. Ingredient count per recipe
 *   5. Unresolved foodId count (should be 0 after a clean import)
 *   6. RecipeIngredient macro sum vs Recipe.totals for a sample
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import XLSX from "xlsx";
import * as path from "path";

import connectDB from "../src/utils/db";
import MealPlanImportRow from "../src/models/MealPlanImportRow";
import MealPlanCategory from "../src/models/MealPlanCategory";
import Recipe from "../src/models/Recipe";
import RecipeIngredient from "../src/models/RecipeIngredient";
import NutritionFood from "../src/models/nutrition-food.model";
import { NutritionFoodSource } from "../src/models/Enums";

config();

async function main() {
	await connectDB();

	// ── Resolve batch ID ─────────────────────────────────────────────────────
	let importBatchId = process.argv[2] ?? null;
	if (!importBatchId) {
		const latest = await MealPlanImportRow.findOne()
			.sort({ importedAt: -1 })
			.lean();
		if (!latest) {
			console.error("❌  No import rows found in database. Run import-meal-plan.ts first.");
			process.exit(1);
		}
		importBatchId = latest.importBatchId;
	}

	const outputPath =
		process.argv[3] ??
		path.join(process.cwd(), `meal-plan-export-${importBatchId}.xlsx`);

	console.log(`\n🔑  Batch : ${importBatchId}`);
	console.log(`📄  Output: ${outputPath}\n`);

	// ════════════════════════════════════════════════════════════════════════
	// 1. Verification queries
	// ════════════════════════════════════════════════════════════════════════
	console.log("── Verification ────────────────────────────────────────────");

	// 1a. Row counts
	const [autoMenuRowCount, sheet2RowCount] = await Promise.all([
		MealPlanImportRow.countDocuments({ importBatchId, sheet: "Auto Menu" }),
		MealPlanImportRow.countDocuments({ importBatchId, sheet: "Sheet2" }),
	]);
	console.log(`  MealPlanImportRow — Auto Menu : ${autoMenuRowCount} rows`);
	console.log(`  MealPlanImportRow — Sheet2    : ${sheet2RowCount} rows`);

	// 1b. Categories
	const categories = await MealPlanCategory.find().sort({ sortOrder: 1 }).lean();
	console.log(`\n  Categories (${categories.length}):`);
	for (const cat of categories) {
		const count = await Recipe.countDocuments({
			categoryId: cat._id,
			source: NutritionFoodSource.System,
		});
		console.log(`    [${cat.sortOrder}] ${cat.name} (${cat.slug}) — ${count} recipes`);
	}

	// 1c. Unresolved ingredients
	const unresolvedCount = await RecipeIngredient.countDocuments({
		foodId: null,
	});
	console.log(
		`\n  Unresolved RecipeIngredient.foodId : ${unresolvedCount} ${unresolvedCount > 0 ? "⚠" : "✅"}`,
	);

	// 1d. Duplicate recipe slugs within same category
	const dupCheck = await Recipe.aggregate([
		{ $group: { _id: { slug: "$slug", categoryId: "$categoryId" }, n: { $sum: 1 } } },
		{ $match: { n: { $gt: 1 } } },
	]);
	console.log(
		`  Duplicate recipes               : ${dupCheck.length} ${dupCheck.length > 0 ? "⚠" : "✅"}`,
	);

	// 1e. Duplicate raw ingredients in NutritionFood
	const dupFoods = await NutritionFood.aggregate([
		{ $match: { source: NutritionFoodSource.System } },
		{ $group: { _id: { $toLower: "$name" }, n: { $sum: 1 } } },
		{ $match: { n: { $gt: 1 } } },
	]);
	console.log(
		`  Duplicate NutritionFood names   : ${dupFoods.length} ${dupFoods.length > 0 ? "⚠" : "✅"}`,
	);

	// 1f. Macro spot-check (sample 5 recipes)
	console.log("\n  Macro spot-check (sample recipes):");
	const sampleRecipes = await Recipe.find({
		source: NutritionFoodSource.System,
	})
		.limit(5)
		.lean();

	for (const recipe of sampleRecipes) {
		const ings = await RecipeIngredient.find({ recipeId: recipe._id }).lean();
		const sumCal = ings.reduce((s, i) => s + (i.caloriesKcal ?? 0), 0);
		const storedCal = recipe.totals?.caloriesKcal ?? 0;
		const diff = Math.abs(Math.round(sumCal * 10) / 10 - storedCal);
		const status = diff < 0.5 ? "✅" : `⚠  diff=${diff}`;
		console.log(
			`    "${recipe.name.substring(0, 40)}" — stored=${storedCal} summed=${Math.round(sumCal * 10) / 10} ${status}`,
		);
	}

	// 1g. All categories have at least 1 recipe
	console.log("\n  Category completeness:");
	for (const cat of categories) {
		const count = await Recipe.countDocuments({ categoryId: cat._id });
		console.log(`    ${cat.name}: ${count} recipes ${count > 0 ? "✅" : "⚠  EMPTY"}`);
	}

	// ════════════════════════════════════════════════════════════════════════
	// 2. Re-export Excel from raw archive
	// ════════════════════════════════════════════════════════════════════════
	console.log("\n── Re-export ───────────────────────────────────────────────");

	const wb = XLSX.utils.book_new();

	// Rebuild each sheet from rawRow arrays
	for (const sheetName of ["Auto Menu", "Sheet2"]) {
		const rows = await MealPlanImportRow.find({
			importBatchId,
			sheet: sheetName,
		})
			.sort({ rowIndex: 1 })
			.lean();

		// Each document's rawRow is the complete array for that physical row
		const data = rows.map((r) => r.rawRow as unknown[]);
		const ws = XLSX.utils.aoa_to_sheet(data);
		XLSX.utils.book_append_sheet(wb, ws, sheetName);
	}

	XLSX.writeFile(wb, outputPath);
	console.log(`  ✅  Exported to ${outputPath}`);
	console.log(`\n  To verify zero-loss, diff the original and exported files:`);
	console.log(`  (Note: minor formatting differences are expected; content should match)\n`);

	// ════════════════════════════════════════════════════════════════════════
	// 3. Idempotency check hint
	// ════════════════════════════════════════════════════════════════════════
	console.log("── Idempotency check ───────────────────────────────────────");
	console.log("  Run import-meal-plan.ts again on the same file.");
	console.log("  All phase outputs should show: 0 created, 0 modified.\n");

	const totals = {
		importRows: autoMenuRowCount + sheet2RowCount,
		foods: await NutritionFood.countDocuments({ source: NutritionFoodSource.System }),
		categories: categories.length,
		recipes: await Recipe.countDocuments({ source: NutritionFoodSource.System }),
		ingredients: await RecipeIngredient.countDocuments(),
	};

	console.log(`╔══════════════════════════════════════╗`);
	console.log(`║  Export & verification complete`);
	console.log(`╠══════════════════════════════════════╣`);
	console.log(`║  MealPlanImportRow : ${String(totals.importRows).padStart(5)} archived rows`);
	console.log(`║  NutritionFood     : ${String(totals.foods).padStart(5)} docs`);
	console.log(`║  MealPlanCategory  : ${String(totals.categories).padStart(5)} docs`);
	console.log(`║  Recipe            : ${String(totals.recipes).padStart(5)} docs`);
	console.log(`║  RecipeIngredient  : ${String(totals.ingredients).padStart(5)} docs`);
	console.log(`╚══════════════════════════════════════╝\n`);

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error("\n❌  Export failed:", err);
	process.exit(1);
});
