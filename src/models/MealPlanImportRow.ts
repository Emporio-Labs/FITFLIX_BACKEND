import mongoose from "mongoose";
import { ImportRowType } from "./Enums";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

// Resolved FK references set after Phase F of the import.
const resolvedRefsSchema = new mongoose.Schema(
	{
		categoryId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "MealPlanCategory",
			default: null,
		},
		recipeId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Recipe",
			default: null,
		},
		foodId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "NutritionFood",
			default: null,
		},
		recipeIngredientId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "RecipeIngredient",
			default: null,
		},
	},
	{ _id: false },
);

// One entry per category that has data in this physical row.
// The "Auto Menu" sheet has up to 5 categories side by side, so a single
// physical row can produce up to 5 segments.
const autoMenuSegmentSchema = new mongoose.Schema(
	{
		categorySlug: { type: String, required: true },
		colOffset: { type: Number, required: true },
		// Cell values verbatim (null when the cell was empty)
		recipe: { type: String, default: null },
		ingredient: { type: String, default: null },
		quantity: { type: String, default: null },
		calories: { type: String, default: null },
		protein: { type: String, default: null },
		carbs: { type: String, default: null },
		fat: { type: String, default: null },
		// Row type for this specific segment
		segmentType: {
			type: String,
			enum: Object.values(ImportRowType),
			default: ImportRowType.Empty,
		},
		resolved: { type: resolvedRefsSchema, default: () => ({}) },
	},
	{ _id: false },
);

// ─── Main schema ──────────────────────────────────────────────────────────────

// IMMUTABLE archive — write-once.  Every physical Excel row is stored here
// before any semantic processing begins.  This document is the single source
// of truth for re-exporting the original Excel file.
//
// For Sheet2 rows   : sheet2Data is populated, autoMenuSegments is empty.
// For Auto Menu rows: autoMenuSegments has 1-5 entries (one per active
//                     category column band), sheet2Data is null.

const mealPlanImportRowSchema = new mongoose.Schema(
	{
		// Groups all rows from one import run (SHA-256 of file content, first 16 hex)
		importBatchId: { type: String, required: true },
		fileName: { type: String, required: true },
		sheet: { type: String, required: true }, // "Auto Menu" | "Sheet2"
		rowIndex: { type: Number, required: true }, // 0-based physical row index
		// Complete raw cell array exactly as xlsx parsed it — the ground truth for
		// lossless re-export.  Stored as Mixed to accept any JSON-serialisable value.
		rawRow: { type: mongoose.Schema.Types.Mixed, required: true },

		// ─── Sheet2 ───────────────────────────────────────────────────────────
		sheet2Data: {
			raw: { type: String, default: null },
			quantityG: { type: String, default: null },
			calories: { type: String, default: null },
			protein: { type: String, default: null },
			carbs: { type: String, default: null },
			fat: { type: String, default: null },
		},

		// ─── Auto Menu ────────────────────────────────────────────────────────
		// One entry per category column band that had any non-null data in this row
		autoMenuSegments: { type: [autoMenuSegmentSchema], default: [] },

		importedAt: { type: Date, default: Date.now },
	},
	{ timestamps: true },
);

mealPlanImportRowSchema.index(
	{ importBatchId: 1, sheet: 1, rowIndex: 1 },
	{ unique: true },
);
mealPlanImportRowSchema.index({ importBatchId: 1 });
mealPlanImportRowSchema.index({ sheet: 1 });

export type MealPlanImportRowDocument = mongoose.InferSchemaType<
	typeof mealPlanImportRowSchema
>;

const MealPlanImportRow =
	(mongoose.models
		.MealPlanImportRow as mongoose.Model<MealPlanImportRowDocument>) ||
	mongoose.model<MealPlanImportRowDocument>(
		"MealPlanImportRow",
		mealPlanImportRowSchema,
	);

export default MealPlanImportRow;
