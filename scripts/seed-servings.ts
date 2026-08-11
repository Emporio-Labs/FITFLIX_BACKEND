/**
 * scripts/seed-servings.ts
 *
 * Best-effort household-portion seed for the existing NutritionFood catalog
 * (seeded from `Standardized Meal Plan.Fitflix^L.xlsx` via import-meal-plan.ts).
 * OFF supplies at most one serving per product and never for home-cooked
 * Indian dishes, so this is authored data, matched by keyword against food
 * names — not derived from any external source. Review the --dry-run output
 * before committing; a keyword match is a heuristic, not a guarantee.
 *
 * Idempotent: only updates foods whose `servings` array is currently empty,
 * so a nutritionist's manual correction is never overwritten by a re-run.
 *
 * Usage:
 *   bun run scripts/seed-servings.ts [--dry-run]
 *
 * Env vars required: MONGODB_URL
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import NutritionFood from "../src/models/nutrition-food.model";
import connectDB from "../src/utils/db";

config();

const isDryRun = process.argv.includes("--dry-run");

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

type Serving = { label: string; gramsPerUnit: number; isDefault: boolean };

// First matching keyword wins — ordered from most to least specific so e.g.
// "egg white" doesn't fall through to a generic "egg" rule it shouldn't.
// gramsPerUnit values are standard household-measure approximations, not
// per-product lab data.
const RULES: { keywords: string[]; servings: Omit<Serving, "isDefault">[] }[] =
	[
		{
			keywords: ["roti", "chapati", "phulka"],
			servings: [{ label: "1 roti", gramsPerUnit: 40 }],
		},
		{
			keywords: ["paratha"],
			servings: [{ label: "1 paratha", gramsPerUnit: 60 }],
		},
		{ keywords: ["idli"], servings: [{ label: "1 idli", gramsPerUnit: 40 }] },
		{ keywords: ["dosa"], servings: [{ label: "1 dosa", gramsPerUnit: 80 }] },
		{ keywords: ["naan"], servings: [{ label: "1 naan", gramsPerUnit: 90 }] },
		{
			keywords: ["boiled egg", "whole egg", "egg boiled"],
			servings: [{ label: "1 egg", gramsPerUnit: 50 }],
		},
		{
			keywords: ["banana"],
			servings: [{ label: "1 medium banana", gramsPerUnit: 118 }],
		},
		{
			keywords: ["apple"],
			servings: [{ label: "1 medium apple", gramsPerUnit: 182 }],
		},
		{
			keywords: ["milk"],
			servings: [
				{ label: "1 glass", gramsPerUnit: 250 },
				{ label: "1 cup", gramsPerUnit: 200 },
			],
		},
		{
			keywords: ["curd", "yogurt", "yoghurt", "dahi"],
			servings: [
				{ label: "1 katori", gramsPerUnit: 150 },
				{ label: "1 cup", gramsPerUnit: 200 },
			],
		},
		{
			keywords: ["rice"],
			servings: [
				{ label: "1 katori", gramsPerUnit: 150 },
				{ label: "1 cup", gramsPerUnit: 200 },
			],
		},
		{
			keywords: ["dal", "sambar", "rasam", "curry", "sabzi", "gravy"],
			servings: [{ label: "1 katori", gramsPerUnit: 150 }],
		},
		{
			keywords: ["tea", "coffee", "chai"],
			servings: [{ label: "1 cup", gramsPerUnit: 150 }],
		},
		{
			keywords: ["bread", "toast"],
			servings: [{ label: "1 slice", gramsPerUnit: 30 }],
		},
		{
			keywords: ["almond"],
			servings: [{ label: "10 almonds", gramsPerUnit: 12 }],
		},
	];

const matchServings = (name: string): Serving[] | null => {
	const lower = name.toLowerCase();
	for (const rule of RULES) {
		if (rule.keywords.some((k) => lower.includes(k))) {
			return rule.servings.map((s, i) => ({ ...s, isDefault: i === 0 }));
		}
	}
	return null;
};

async function main() {
	await connectDB();

	// Only foods without any servings yet — never touch a food a nutritionist
	// (or a previous run) has already set servings on.
	const foods = await NutritionFood.find({
		isActive: true,
		$or: [{ servings: { $exists: false } }, { servings: { $size: 0 } }],
	}).select("_id name servings");

	console.log(
		bold(`\nScanning ${foods.length} foods without household servings...\n`),
	);

	const matches: { id: string; name: string; servings: Serving[] }[] = [];
	for (const food of foods) {
		const servings = matchServings(food.name);
		if (servings) {
			matches.push({ id: food._id.toString(), name: food.name, servings });
		}
	}

	console.log(green(`Matched ${matches.length} / ${foods.length} foods:\n`));
	for (const m of matches) {
		const labels = m.servings
			.map((s) => `${s.label}=${s.gramsPerUnit}g`)
			.join(", ");
		console.log(`  ${m.name} ${dim(`(${m.id})`)} -> ${labels}`);
	}

	const unmatchedCount = foods.length - matches.length;
	if (unmatchedCount > 0) {
		console.log(
			yellow(
				`\n${unmatchedCount} foods had no keyword match and were left unchanged (still basePer:100 grams-only).`,
			),
		);
	}

	if (isDryRun) {
		console.log(bold("\n--dry-run: no writes made.\n"));
		process.exit(0);
	}

	if (matches.length === 0) {
		console.log(bold("\nNothing to write.\n"));
		process.exit(0);
	}

	// Mongoose's bulkWrite generics don't line up cleanly with a plain
	// {label,gramsPerUnit,isDefault}[] against the schema's inferred
	// subdocument type — cast at this single call site rather than fighting
	// it in a one-off seed script.
	const result = await NutritionFood.bulkWrite(
		matches.map((m) => ({
			updateOne: {
				filter: { _id: new mongoose.Types.ObjectId(m.id) },
				update: { $set: { servings: m.servings } },
			},
		})) as Parameters<typeof NutritionFood.bulkWrite>[0],
	);

	console.log(
		green(
			`\n✓ Updated ${result.modifiedCount} foods with household servings.\n`,
		),
	);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
