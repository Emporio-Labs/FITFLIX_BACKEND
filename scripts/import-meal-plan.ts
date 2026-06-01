/**
 * scripts/import-meal-plan.ts
 *
 * Six-phase zero-loss import of Standardized Meal Plan.Fitflix^L.xlsx
 * into MongoDB.
 *
 * Usage:
 *   bun run scripts/import-meal-plan.ts [path/to/file.xlsx]
 *
 * Env vars required:
 *   MONGODB_URL
 *
 * Phases:
 *   A – Write MealPlanImportRow (lossless raw archive) for every row
 *   B – NutritionFood from Sheet2 raw ingredient master
 *   C – MealPlanCategory (one per category column band)
 *   D – Recipe (one per unique recipe name per category)
 *   E – RecipeIngredient + NutritionFood for any ingredient not already seeded
 *   F – Back-fill MealPlanImportRow.resolved FKs
 *
 * Every phase uses bulkWrite upserts so re-running on the same file is idempotent
 * (0 docs modified on second run).
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

import connectDB from "../src/utils/db";
import NutritionFood from "../src/models/nutrition-food.model";
import MealPlanImportRow from "../src/models/MealPlanImportRow";
import MealPlanCategory from "../src/models/MealPlanCategory";
import Recipe from "../src/models/Recipe";
import RecipeIngredient from "../src/models/RecipeIngredient";
import {
	ImportRowType,
	IngredientUnit,
	MealType,
	NutritionFoodSource,
} from "../src/models/Enums";

config();

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract a numeric value from any cell, stripping "kcal"/"cal" suffixes. */
function parseNum(val: unknown): number | null {
	if (val == null || val === "") return null;
	const str = String(val)
		.trim()
		.replace(/kcal/gi, "")
		.replace(/\bcal\b/gi, "");
	const m = str.match(/^-?(\d+(?:\.\d+)?)/);
	return m?.[1] != null ? parseFloat(m[1]) : null;
}

/** Produce a URL-safe slug from any string. */
function slugify(str: string): string {
	return str
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Return true when a cell value is a "Total" summary row marker. */
function isTotal(val: unknown): boolean {
	if (typeof val !== "string") return false;
	const t = val.trim().toLowerCase();
	return t === "total" || t === "totals";
}

/** Return true when a recipe/ingredient text implies non-vegetarian. */
function isNonVegText(text: string): boolean {
	const lower = text.toLowerCase();
	return [
		"chicken",
		"fish",
		"egg",
		"eggs",
		"mutton",
		"prawn",
		"shrimp",
		"beef",
		"pork",
		"tuna",
		"meat",
		"boneless",
		"omlette",
		"omelet",
	].some((kw) => lower.includes(kw));
}

/** Extract numeric quantity from raw cell string. */
function extractQty(raw: string | null): number | null {
	if (!raw) return null;
	const m = String(raw).match(/^(\d+(?:\.\d+)?)/);
	return m?.[1] != null ? parseFloat(m[1]) : null;
}

/** Infer measurement unit from raw quantity string and category default. */
function inferUnit(
	raw: string | null,
	defaultUnit: "g" | "ml",
): IngredientUnit {
	if (!raw) return defaultUnit as IngredientUnit;
	const s = raw.toLowerCase();
	if (s.includes("ml")) return IngredientUnit.Milliliter;
	if (s.includes(" g") || /\d+g/.test(s)) return IngredientUnit.Gram;
	return defaultUnit as IngredientUnit;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Category config — maps Excel header text → metadata
// ═══════════════════════════════════════════════════════════════════════════════

interface CategoryConfig {
	slug: string;
	displayName: string;
	defaultMealType: MealType;
	defaultUnit: "g" | "ml";
	hasVegVariant: boolean;
	hasNonVegVariant: boolean;
	sortOrder: number;
}

const CATEGORY_CONFIG_MAP: Array<{
	keywords: string[];
	config: CategoryConfig;
}> = [
	{
		keywords: ["salad"],
		config: {
			slug: "salads",
			displayName: "Salads",
			defaultMealType: MealType.Lunch,
			defaultUnit: "g",
			hasVegVariant: true,
			hasNonVegVariant: true,
			sortOrder: 1,
		},
	},
	{
		keywords: ["rice bowl", "rice bowls"],
		config: {
			slug: "rice-bowls",
			displayName: "Rice Bowls",
			defaultMealType: MealType.Lunch,
			defaultUnit: "g",
			hasVegVariant: true,
			hasNonVegVariant: true,
			sortOrder: 2,
		},
	},
	{
		keywords: ["juice"],
		config: {
			slug: "juices",
			displayName: "Healthy Juices",
			defaultMealType: MealType.EarlyMorning,
			defaultUnit: "ml",
			hasVegVariant: true,
			hasNonVegVariant: false,
			sortOrder: 3,
		},
	},
	{
		keywords: ["smoothie"],
		config: {
			slug: "smoothies",
			displayName: "Smoothies",
			defaultMealType: MealType.PreWorkout,
			defaultUnit: "ml",
			hasVegVariant: true,
			hasNonVegVariant: false,
			sortOrder: 4,
		},
	},
	{
		keywords: ["sandwich", "sandwiches"],
		config: {
			slug: "sandwiches",
			displayName: "Sandwiches",
			defaultMealType: MealType.Breakfast,
			defaultUnit: "g",
			hasVegVariant: true,
			hasNonVegVariant: true,
			sortOrder: 5,
		},
	},
];

function matchCategory(headerText: string): CategoryConfig | null {
	const lower = headerText.toLowerCase();
	for (const { keywords, config } of CATEGORY_CONFIG_MAP) {
		if (keywords.some((kw) => lower.includes(kw))) return config;
	}
	return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Internal data types (in-memory parse results)
// ═══════════════════════════════════════════════════════════════════════════════

interface IngredientParsed {
	rowIndex: number;
	rawIngredientName: string;
	rawQuantityStr: string | null;
	quantity: number | null;
	unit: IngredientUnit;
	caloriesKcal: number | null;
	proteinG: number | null;
	carbsG: number | null;
	fatG: number | null;
}

interface RecipeParsed {
	name: string;
	slug: string;
	categorySlug: string;
	isVeg: boolean | null;
	ingredients: IngredientParsed[];
	excelTotals: {
		caloriesKcal: number | null;
		proteinG: number | null;
		carbsG: number | null;
		fatG: number | null;
	} | null;
	firstRowIndex: number;
}

interface CategoryParsed {
	colOffset: number;
	headerText: string;
	config: CategoryConfig;
	recipes: RecipeParsed[];
}

interface Sheet2Row {
	rowIndex: number;
	raw: string; // cellStr() + null-guard in parseSheet2 ensures non-null
	quantityG: string | null;
	calories: string | null;
	protein: string | null;
	carbs: string | null;
	fat: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase-A helper: classify a segment's row type
// ═══════════════════════════════════════════════════════════════════════════════

function classifySegmentType(
	rowIndex: number,
	recipe: string | null,
	ingredient: string | null,
	quantity: string | null,
	calories: string | null,
): ImportRowType {
	if (rowIndex === 0) return ImportRowType.CategoryHeader;
	if (rowIndex === 1) return ImportRowType.ColumnHeader;
	const allNull =
		!recipe && !ingredient && !quantity && !calories;
	if (allNull) return ImportRowType.Empty;
	if (isTotal(recipe) || isTotal(ingredient)) return ImportRowType.Total;
	// Silent total: no recipe/ingredient name but numeric values present
	if (!recipe && !ingredient && (parseNum(quantity) != null || parseNum(calories) != null)) {
		return ImportRowType.Total;
	}
	if (recipe && !isTotal(recipe)) return ImportRowType.Recipe;
	if (!recipe && ingredient && !isTotal(ingredient)) return ImportRowType.Ingredient;
	return ImportRowType.Empty;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parser: Auto Menu sheet
// ═══════════════════════════════════════════════════════════════════════════════

function parseAutoMenu(rows: unknown[][]): CategoryParsed[] {
	const row0 = rows[0] as (string | null)[];

	// Detect category column offsets from row 0
	const categoryBands: Array<{ colOffset: number; headerText: string }> = [];
	row0.forEach((cell, colIdx) => {
		if (cell && typeof cell === "string" && cell.trim().length > 0) {
			categoryBands.push({ colOffset: colIdx, headerText: cell.trim() });
		}
	});

	const result: CategoryParsed[] = [];

	for (const band of categoryBands) {
		const config = matchCategory(band.headerText);
		if (!config) {
			console.warn(
				`  ⚠  Unrecognised category header "${band.headerText}" at col ${band.colOffset} — skipped`,
			);
			continue;
		}

		const { colOffset } = band;
		const recipes: RecipeParsed[] = [];
		let currentRecipe: RecipeParsed | null = null;

		for (let ri = 2; ri < rows.length; ri++) {
			const row = rows[ri] as unknown[];
			const recipe = cellStr(row[colOffset + 0]);
			const ingredient = cellStr(row[colOffset + 1]);
			const quantity = cellStr(row[colOffset + 2]);
			const cal = cellStr(row[colOffset + 3]);
			const pro = cellStr(row[colOffset + 4]);
			const carb = cellStr(row[colOffset + 5]);
			const fat = cellStr(row[colOffset + 6]);

			const allNull = !recipe && !ingredient && !quantity && !cal && !pro && !carb && !fat;
			if (allNull) continue;

			// ── Total rows (explicit or silent) ──────────────────────────────
			const recipeIsTotal = isTotal(recipe);
			const ingredientIsTotal = isTotal(ingredient);
			const isSilentTotal =
				!recipe && !ingredient &&
				(parseNum(quantity) != null || parseNum(cal) != null);

			if (recipeIsTotal || ingredientIsTotal || isSilentTotal) {
				if (currentRecipe && !currentRecipe.excelTotals) {
					if (ingredientIsTotal) {
						// Normal format: "Total" in ingredient col; values in cal/pro/carb/fat
						currentRecipe.excelTotals = {
							caloriesKcal: parseNum(cal),
							proteinG: parseNum(pro),
							carbsG: parseNum(carb),
							fatG: parseNum(fat),
						};
					} else if (recipeIsTotal) {
						// Shifted format: "Total" in recipe col; values shift left by 1
						currentRecipe.excelTotals = {
							caloriesKcal: parseNum(quantity),
							proteinG: parseNum(cal),
							carbsG: parseNum(pro),
							fatG: parseNum(carb),
						};
					} else {
						// Silent total: values in qty/cal/pro/carb positions
						currentRecipe.excelTotals = {
							caloriesKcal: parseNum(cal),
							proteinG: parseNum(pro),
							carbsG: parseNum(carb),
							fatG: parseNum(fat),
						};
					}
				}
				continue;
			}

			// ── New recipe ───────────────────────────────────────────────────
			if (recipe) {
				currentRecipe = {
					name: recipe,
					slug: slugify(recipe),
					categorySlug: config.slug,
					isVeg: null, // computed later from ingredients
					ingredients: [],
					excelTotals: null,
					firstRowIndex: ri,
				};
				recipes.push(currentRecipe);

				// First ingredient may appear on the same row
				if (ingredient && !isTotal(ingredient)) {
					currentRecipe.ingredients.push(
						makeIngredient(ingredient, quantity, cal, pro, carb, fat, ri, config.defaultUnit),
					);
				}
				continue;
			}

			// ── Ingredient continuation ──────────────────────────────────────
			if (!recipe && ingredient && !isTotal(ingredient)) {
				if (!currentRecipe) {
					console.warn(
						`  ⚠  Orphan ingredient "${ingredient}" at row ${ri} col ${colOffset} — skipped`,
					);
					continue;
				}
				currentRecipe.ingredients.push(
					makeIngredient(ingredient, quantity, cal, pro, carb, fat, ri, config.defaultUnit),
				);
			}
		}

		// Compute isVeg per recipe from aggregated ingredient names
		for (const recipe of recipes) {
			const allText = [recipe.name, ...recipe.ingredients.map((i) => i.rawIngredientName)].join(" ");
			recipe.isVeg = isNonVegText(allText) ? false : true;
		}

		result.push({
			colOffset,
			headerText: band.headerText,
			config,
			recipes,
		});
	}

	return result;
}

function cellStr(val: unknown): string | null {
	if (val == null || val === "") return null;
	const s = String(val).trim();
	return s.length > 0 ? s : null;
}

function makeIngredient(
	ingredient: string,
	quantity: string | null,
	cal: string | null,
	pro: string | null,
	carb: string | null,
	fat: string | null,
	rowIndex: number,
	defaultUnit: "g" | "ml",
): IngredientParsed {
	return {
		rowIndex,
		rawIngredientName: ingredient,
		rawQuantityStr: quantity,
		quantity: extractQty(quantity),
		unit: inferUnit(quantity, defaultUnit),
		caloriesKcal: parseNum(cal),
		proteinG: parseNum(pro),
		carbsG: parseNum(carb),
		fatG: parseNum(fat),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parser: Sheet2
// ═══════════════════════════════════════════════════════════════════════════════

function parseSheet2(rows: unknown[][]): Sheet2Row[] {
	const result: Sheet2Row[] = [];
	for (let ri = 1; ri < rows.length; ri++) {
		const row = rows[ri] as unknown[];
		const raw = cellStr(row[0]);
		// Skip header repetition or pure total rows (no ingredient name)
		if (!raw) continue;
		result.push({
			rowIndex: ri,
			raw,
			quantityG: cellStr(row[1]),
			calories: cellStr(row[2]),
			protein: cellStr(row[3]),
			carbs: cellStr(row[4]),
			fat: cellStr(row[5]),
		});
	}
	return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
	// ── Resolve file path ────────────────────────────────────────────────────
	// The filename contains a form-feed character (\f, 0x0C) shown as ^L in
	// terminals, so we find it dynamically rather than hardcoding the literal.
	let filePath = process.argv[2] ?? null;
	if (!filePath) {
		const xlsxFiles = fs
			.readdirSync(process.cwd())
			.filter((f) => f.endsWith(".xlsx"));
		if (xlsxFiles.length === 0) {
			console.error(
				"❌  No .xlsx file found in current directory. Pass a path explicitly:\n" +
				'   bun run scripts/import-meal-plan.ts "path/to/file.xlsx"',
			);
			process.exit(1);
		}
		// If multiple xlsx files exist, prefer the meal-plan source file over any exports.
		// Fall back to the first file alphabetically if no heuristic matches.
		const preferred =
			xlsxFiles.find((f) => /meal.plan/i.test(f) && !/export/i.test(f)) ??
			xlsxFiles.find((f) => /standardized/i.test(f)) ??
			xlsxFiles[0] ??
			"";
		if (xlsxFiles.length > 1) {
			console.warn(`  ⚠  Multiple xlsx files found, using: ${preferred}`);
		}
		filePath = path.join(process.cwd(), preferred);
	}

	if (!fs.existsSync(filePath)) {
		console.error(`❌  File not found: ${filePath}`);
		process.exit(1);
	}

	const fileBuffer = fs.readFileSync(filePath);
	const importBatchId = crypto
		.createHash("sha256")
		.update(fileBuffer)
		.digest("hex")
		.substring(0, 16);
	const fileName = path.basename(filePath);

	console.log(`\n📂  File : ${fileName}`);
	console.log(`🔑  Batch: ${importBatchId}\n`);

	// ── Parse Excel ──────────────────────────────────────────────────────────
	const wb = XLSX.read(fileBuffer, { type: "buffer", raw: false });
	const autoMenuSheet = wb.Sheets["Auto Menu"];
	const sheet2Sheet = wb.Sheets["Sheet2"];
	if (!autoMenuSheet || !sheet2Sheet) {
		console.error('❌  Excel file must contain "Auto Menu" and "Sheet2" sheets');
		console.error(`  Found sheets: ${wb.SheetNames.join(", ")}`);
		process.exit(1);
	}
	const autoMenuRows = XLSX.utils.sheet_to_json<unknown[]>(autoMenuSheet, {
		header: 1,
		raw: false,
		defval: null,
	});
	const sheet2Rows = XLSX.utils.sheet_to_json<unknown[]>(sheet2Sheet, {
		header: 1,
		raw: false,
		defval: null,
	});

	// Pre-parse into typed structures
	const categories = parseAutoMenu(autoMenuRows);
	const sheet2Data = parseSheet2(sheet2Rows);

	// ── Connect DB ───────────────────────────────────────────────────────────
	await connectDB();

	// ════════════════════════════════════════════════════════════════════════
	// Phase A — Lossless raw archive (MealPlanImportRow)
	// ════════════════════════════════════════════════════════════════════════
	console.log("── Phase A: writing raw archive ────────────────────────────");

	// Build a lookup: rowIndex → autoMenuSegments for Phase A
	// We need to know which category each row belongs to for segment typing
	const rowSegmentMap = new Map<
		number,
		Array<{
			categorySlug: string;
			colOffset: number;
			recipe: string | null;
			ingredient: string | null;
			quantity: string | null;
			calories: string | null;
			protein: string | null;
			carbs: string | null;
			fat: string | null;
			segmentType: ImportRowType;
		}>
	>();

	// Derive category band boundaries
	const bandOffsets = categories.map((c) => c.colOffset);

	for (let ri = 0; ri < autoMenuRows.length; ri++) {
		const row = autoMenuRows[ri] as unknown[];
		const segments: NonNullable<ReturnType<typeof rowSegmentMap.get>> = [];

		for (const cat of categories) {
			const { colOffset, config } = cat;
			const recipe = cellStr(row[colOffset + 0]);
			const ingredient = cellStr(row[colOffset + 1]);
			const quantity = cellStr(row[colOffset + 2]);
			const calories = cellStr(row[colOffset + 3]);
			const protein = cellStr(row[colOffset + 4]);
			const carbs = cellStr(row[colOffset + 5]);
			const fat = cellStr(row[colOffset + 6]);

			const segmentType = classifySegmentType(ri, recipe, ingredient, quantity, calories);

			// Only store segment if it has any non-null content (or is the header row)
			const hasContent =
				ri <= 1 ||
				recipe != null || ingredient != null || quantity != null ||
				calories != null || protein != null || carbs != null || fat != null;

			if (!hasContent) continue;

			segments.push({
				categorySlug: config.slug,
				colOffset,
				recipe,
				ingredient,
				quantity,
				calories,
				protein,
				carbs,
				fat,
				segmentType,
			});
		}
		if (segments.length > 0) {
			rowSegmentMap.set(ri, segments);
		}
	}

	// Upsert Auto Menu rows
	const autoMenuOps = autoMenuRows
		.map((rawRow, ri) => {
			const segs = rowSegmentMap.get(ri) ?? [];
			return {
				updateOne: {
					filter: { importBatchId, sheet: "Auto Menu", rowIndex: ri },
					update: {
						$setOnInsert: {
							importBatchId,
							fileName,
							sheet: "Auto Menu",
							rowIndex: ri,
							rawRow: rawRow as unknown[],
							sheet2Data: null,
							autoMenuSegments: segs,
							importedAt: new Date(),
						},
					},
					upsert: true,
				},
			};
		});

	// Upsert Sheet2 rows
	const sheet2Ops = sheet2Rows.map((rawRow, ri) => {
		const s = sheet2Data.find((d) => d.rowIndex === ri);
		return {
			updateOne: {
				filter: { importBatchId, sheet: "Sheet2", rowIndex: ri },
				update: {
					$setOnInsert: {
						importBatchId,
						fileName,
						sheet: "Sheet2",
						rowIndex: ri,
						rawRow: rawRow as unknown[],
						sheet2Data: s
							? {
									raw: s.raw,
									quantityG: s.quantityG,
									calories: s.calories,
									protein: s.protein,
									carbs: s.carbs,
									fat: s.fat,
								}
							: null,
						autoMenuSegments: [],
						importedAt: new Date(),
					},
				},
				upsert: true,
			},
		};
	});

	const resA1 = await MealPlanImportRow.bulkWrite(autoMenuOps as Parameters<typeof MealPlanImportRow.bulkWrite>[0]);
	const resA2 = await MealPlanImportRow.bulkWrite(sheet2Ops as Parameters<typeof MealPlanImportRow.bulkWrite>[0]);
	console.log(
		`  Auto Menu: ${resA1.upsertedCount} inserted, ${resA1.modifiedCount} modified`,
	);
	console.log(
		`  Sheet2   : ${resA2.upsertedCount} inserted, ${resA2.modifiedCount} modified`,
	);

	// ════════════════════════════════════════════════════════════════════════
	// Phase B — NutritionFood from Sheet2
	// ════════════════════════════════════════════════════════════════════════
	console.log("\n── Phase B: seeding NutritionFood from Sheet2 ──────────────");

	const foodOps = sheet2Data.map((row) => {
		const basePer = parseNum(row.quantityG) ?? 100;
		const servingLabel = row.quantityG
			? `${parseNum(row.quantityG) ?? row.quantityG} g`
			: "100 g";
		return {
			updateOne: {
				filter: { name: row.raw, source: NutritionFoodSource.System },
				update: {
					$set: {
						name: row.raw,
						source: NutritionFoodSource.System,
						basePer,
						servingLabel,
						caloriesKcal: parseNum(row.calories) ?? 0,
						proteinG: parseNum(row.protein) ?? 0,
						carbsG: parseNum(row.carbs) ?? 0,
						fatG: parseNum(row.fat) ?? 0,
						tags: ["raw-ingredient", "sheet2"],
						isActive: true,
					},
				},
				upsert: true,
			},
		};
	});

	const resB = await NutritionFood.bulkWrite(foodOps);
	console.log(
		`  ${resB.upsertedCount} created, ${resB.modifiedCount} updated (${sheet2Data.length} source rows)`,
	);

	// ════════════════════════════════════════════════════════════════════════
	// Phase C — MealPlanCategory
	// ════════════════════════════════════════════════════════════════════════
	console.log("\n── Phase C: seeding MealPlanCategory ───────────────────────");

	const categoryOps = categories.map(({ colOffset, headerText, config }) => ({
		updateOne: {
			filter: { slug: config.slug },
			update: {
				$set: {
					name: config.displayName,
					slug: config.slug,
					headerText,
					hasVegVariant: config.hasVegVariant,
					hasNonVegVariant: config.hasNonVegVariant,
					sortOrder: config.sortOrder,
					colOffset,
					defaultMealType: config.defaultMealType,
					defaultUnit: config.defaultUnit,
				},
			},
			upsert: true,
		},
	}));

	const resC = await MealPlanCategory.bulkWrite(categoryOps);
	console.log(
		`  ${resC.upsertedCount} created, ${resC.modifiedCount} updated (${categories.length} categories)`,
	);

	// Load category documents for FK usage
	const categoryDocs = await MealPlanCategory.find({
		slug: { $in: categories.map((c) => c.config.slug) },
	}).lean();
	const categoryBySlug = new Map(categoryDocs.map((c) => [c.slug, c._id]));

	// ════════════════════════════════════════════════════════════════════════
	// Phase D — Recipe
	// ════════════════════════════════════════════════════════════════════════
	console.log("\n── Phase D: seeding Recipe ─────────────────────────────────");

	let totalRecipes = 0;
	const recipeOps: Parameters<typeof Recipe.bulkWrite>[0] = [];

	for (const cat of categories) {
		const categoryId = categoryBySlug.get(cat.config.slug);
		if (!categoryId) continue;

		for (const recipe of cat.recipes) {
			// Compute totals by summing ingredients (more reliable than Excel totals)
			const sumCal = recipe.ingredients.reduce((s, i) => s + (i.caloriesKcal ?? 0), 0);
			const sumPro = recipe.ingredients.reduce((s, i) => s + (i.proteinG ?? 0), 0);
			const sumCarb = recipe.ingredients.reduce((s, i) => s + (i.carbsG ?? 0), 0);
			const sumFat = recipe.ingredients.reduce((s, i) => s + (i.fatG ?? 0), 0);

			recipeOps.push({
				updateOne: {
					filter: {
						slug: recipe.slug,
						categoryId,
					},
					update: {
						$set: {
							name: recipe.name,
							slug: recipe.slug,
							categoryId,
							isVeg: recipe.isVeg,
							defaultMealType: cat.config.defaultMealType,
							source: NutritionFoodSource.System,
							importBatchId,
							"totals.caloriesKcal": Math.round(sumCal * 10) / 10,
							"totals.proteinG": Math.round(sumPro * 10) / 10,
							"totals.carbsG": Math.round(sumCarb * 10) / 10,
							"totals.fatG": Math.round(sumFat * 10) / 10,
						},
					},
					upsert: true,
				},
			});
			totalRecipes++;
		}
	}

	const resD = await Recipe.bulkWrite(recipeOps);
	console.log(
		`  ${resD.upsertedCount} created, ${resD.modifiedCount} updated (${totalRecipes} recipes)`,
	);

	// Load recipe documents for FK usage
	const recipeDocs = await Recipe.find({
		importBatchId,
		source: NutritionFoodSource.System,
	}).lean();
	const recipeBySlugCategory = new Map(
		recipeDocs.map((r) => [
			`${r.slug}::${String(r.categoryId)}`,
			r._id,
		]),
	);

	// ════════════════════════════════════════════════════════════════════════
	// Phase E — RecipeIngredient + supplemental NutritionFood
	// ════════════════════════════════════════════════════════════════════════
	console.log(
		"\n── Phase E: seeding RecipeIngredient + supplemental NutritionFood ─",
	);

	// Build a lookup of existing NutritionFood by normalized name
	const existingFoods = await NutritionFood.find({
		source: NutritionFoodSource.System,
	}).lean();
	const foodByName = new Map(
		existingFoods.map((f) => [f.name.toLowerCase().trim(), f._id]),
	);

	// Collect supplemental food ops (for ingredients not in Sheet2)
	const suppFoodOps: Parameters<typeof NutritionFood.bulkWrite>[0] = [];
	// Track names we've already queued to avoid duplicates across categories
	const queuedFoodNames = new Set(foodByName.keys());

	let totalIngredients = 0;
	let unresolved = 0;
	const ingredientOps: Parameters<typeof RecipeIngredient.bulkWrite>[0] = [];

	for (const cat of categories) {
		const categoryId = categoryBySlug.get(cat.config.slug);
		if (!categoryId) continue;

		for (const recipe of cat.recipes) {
			const recipeId =
				recipeBySlugCategory.get(`${recipe.slug}::${String(categoryId)}`);
			if (!recipeId) {
				console.warn(`  ⚠  No recipeId for "${recipe.name}" — skipping ingredients`);
				continue;
			}

			for (const [sortOrder, ing] of recipe.ingredients.entries()) {
				const nameKey = ing.rawIngredientName.toLowerCase().trim();

				// Try to resolve foodId
				let foodId = foodByName.get(nameKey) ?? null;

				// If not found in Sheet2, create a supplemental NutritionFood entry
				if (!foodId && !queuedFoodNames.has(nameKey)) {
					queuedFoodNames.add(nameKey);
					const basePer = ing.quantity ?? 100;
					suppFoodOps.push({
						updateOne: {
							filter: {
								name: ing.rawIngredientName,
								source: NutritionFoodSource.System,
							},
							update: {
								$set: {
									name: ing.rawIngredientName,
									source: NutritionFoodSource.System,
									basePer,
									servingLabel: `${basePer} ${ing.unit}`,
									caloriesKcal: ing.caloriesKcal ?? 0,
									proteinG: ing.proteinG ?? 0,
									carbsG: ing.carbsG ?? 0,
									fatG: ing.fatG ?? 0,
									tags: ["auto-menu-derived"],
									isActive: true,
								},
							},
							upsert: true,
						},
					});
				}

				if (!foodId) unresolved++;

				ingredientOps.push({
					updateOne: {
						filter: { recipeId, sortOrder },
						update: {
							$set: {
								recipeId,
								foodId: foodId ?? undefined,
								rawIngredientName: ing.rawIngredientName,
								rawQuantityStr: ing.rawQuantityStr,
								quantity: ing.quantity,
								unit: ing.unit,
								caloriesKcal: ing.caloriesKcal,
								proteinG: ing.proteinG,
								carbsG: ing.carbsG,
								fatG: ing.fatG,
								sortOrder,
							},
						},
						upsert: true,
					},
				});
				totalIngredients++;
			}
		}
	}

	// Write supplemental foods first so subsequent ingredient writes can link to them
	if (suppFoodOps.length > 0) {
		const resE1 = await NutritionFood.bulkWrite(suppFoodOps);
		console.log(
			`  Supplemental NutritionFood: ${resE1.upsertedCount} created, ${resE1.modifiedCount} updated`,
		);

		// Refresh food lookup with newly created docs
		const newFoods = await NutritionFood.find({
			source: NutritionFoodSource.System,
			tags: "auto-menu-derived",
		}).lean();
		for (const f of newFoods) {
			foodByName.set(f.name.toLowerCase().trim(), f._id);
		}
	}

	// Patch foodId on ingredient ops that were unresolved at first pass
	// (now that supplemental foods exist)
	for (const op of ingredientOps) {
		const up = (op as { updateOne: { update: { $set: Record<string, unknown> } } }).updateOne;
		if (up.update.$set.foodId == null) {
			const rawName = String(up.update.$set.rawIngredientName ?? "").toLowerCase().trim();
			const resolvedId = foodByName.get(rawName);
			if (resolvedId) up.update.$set.foodId = resolvedId;
		}
	}

	const resE2 = await RecipeIngredient.bulkWrite(ingredientOps);
	console.log(
		`  RecipeIngredient: ${resE2.upsertedCount} created, ${resE2.modifiedCount} updated (${totalIngredients} total)`,
	);
	if (unresolved > 0) {
		console.log(
			`  ℹ  ${unresolved} ingredient(s) initially unresolved → supplemental NutritionFood created`,
		);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Phase F — Back-fill MealPlanImportRow.resolved FKs
	// ════════════════════════════════════════════════════════════════════════
	console.log("\n── Phase F: back-filling resolved FKs ──────────────────────");

	// Load all ingredient docs to map (recipeId, sortOrder) → _id
	const allIngredients = await RecipeIngredient.find({ }).lean();
	const ingredientByKey = new Map(
		allIngredients.map((i) => [`${String(i.recipeId)}::${i.sortOrder}`, i]),
	);

	// For each category / recipe / ingredient, find the matching import row and
	// update its segment's resolved refs
	const bulkFOps: Parameters<typeof MealPlanImportRow.bulkWrite>[0] = [];

	for (const cat of categories) {
		const categoryId = categoryBySlug.get(cat.config.slug);
		if (!categoryId) continue;

		for (const recipe of cat.recipes) {
			const recipeId =
				recipeBySlugCategory.get(`${recipe.slug}::${String(categoryId)}`);

			// Update the recipe header row
			const recipeImportRow = await MealPlanImportRow.findOne({
				importBatchId,
				sheet: "Auto Menu",
				rowIndex: recipe.firstRowIndex,
			});
			if (recipeImportRow) {
				const segIdx = recipeImportRow.autoMenuSegments.findIndex(
					(s: { categorySlug: string }) => s.categorySlug === cat.config.slug,
				);
				if (segIdx >= 0) {
					bulkFOps.push({
						updateOne: {
							filter: { _id: recipeImportRow._id },
							update: {
								$set: {
									[`autoMenuSegments.${segIdx}.resolved.categoryId`]: categoryId,
									[`autoMenuSegments.${segIdx}.resolved.recipeId`]: recipeId ?? null,
								},
							},
						},
					});
				}
			}

			// Update ingredient rows
			for (const [sortOrder, ing] of recipe.ingredients.entries()) {
				const ingKey = `${String(recipeId)}::${sortOrder}`;
				const ingDoc = ingredientByKey.get(ingKey);
				if (!ingDoc) continue;

				const importRow = await MealPlanImportRow.findOne({
					importBatchId,
					sheet: "Auto Menu",
					rowIndex: ing.rowIndex,
				});
				if (!importRow) continue;

				const segIdx = importRow.autoMenuSegments.findIndex(
					(s: { categorySlug: string }) => s.categorySlug === cat.config.slug,
				);
				if (segIdx >= 0) {
					bulkFOps.push({
						updateOne: {
							filter: { _id: importRow._id },
							update: {
								$set: {
									[`autoMenuSegments.${segIdx}.resolved.categoryId`]: categoryId,
									[`autoMenuSegments.${segIdx}.resolved.recipeId`]: recipeId ?? null,
									[`autoMenuSegments.${segIdx}.resolved.foodId`]: ingDoc.foodId ?? null,
									[`autoMenuSegments.${segIdx}.resolved.recipeIngredientId`]: ingDoc._id,
								},
							},
						},
					});
				}
			}
		}
	}

	// Back-fill Sheet2 resolved refs
	for (const row of sheet2Data) {
		const foodId = foodByName.get((row.raw ?? "").toLowerCase().trim());
		if (!foodId) continue;
		const importRow = await MealPlanImportRow.findOne({
			importBatchId,
			sheet: "Sheet2",
			rowIndex: row.rowIndex,
		});
		if (importRow) {
			bulkFOps.push({
				updateOne: {
					filter: { _id: importRow._id },
					update: { $set: { "sheet2Data.resolvedFoodId": foodId } },
				},
			});
		}
	}

	if (bulkFOps.length > 0) {
		const resF = await MealPlanImportRow.bulkWrite(bulkFOps as Parameters<typeof MealPlanImportRow.bulkWrite>[0]);
		console.log(
			`  ${resF.modifiedCount} import rows updated with resolved FKs`,
		);
	} else {
		console.log("  Nothing to update (already resolved)");
	}

	// ════════════════════════════════════════════════════════════════════════
	// Summary
	// ════════════════════════════════════════════════════════════════════════
	const [foodCount, catCount, recipeCount, ingCount, importRowCount] =
		await Promise.all([
			NutritionFood.countDocuments({ source: NutritionFoodSource.System }),
			MealPlanCategory.countDocuments(),
			Recipe.countDocuments({ source: NutritionFoodSource.System }),
			RecipeIngredient.countDocuments(),
			MealPlanImportRow.countDocuments({ importBatchId }),
		]);

	console.log(`
╔══════════════════════════════════════╗
║  Import complete — ${new Date().toISOString()}
╠══════════════════════════════════════╣
║  MealPlanImportRow : ${String(importRowCount).padStart(5)} rows (archive)
║  NutritionFood     : ${String(foodCount).padStart(5)} docs
║  MealPlanCategory  : ${String(catCount).padStart(5)} docs
║  Recipe            : ${String(recipeCount).padStart(5)} docs
║  RecipeIngredient  : ${String(ingCount).padStart(5)} docs
╚══════════════════════════════════════╝
`);

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error("\n❌  Import failed:", err);
	process.exit(1);
});
