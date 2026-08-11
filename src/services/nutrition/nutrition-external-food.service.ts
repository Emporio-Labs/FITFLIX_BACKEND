import type { HydratedDocument } from "mongoose";
import { NutritionFoodSource } from "../../models/Enums";
import NutritionFood, {
	type NutritionFoodDocument,
} from "../../models/nutrition-food.model";
import type { NutritionActor } from "../../types/nutrition";
import { NutritionServiceError } from "./nutrition-errors";
import { searchFoods } from "./nutrition-food.service";
import {
	type ExternalFoodDto,
	lookupOffBarcode,
	searchOff,
} from "./nutrition-off.adapter";

// Common shape for both a persisted catalog food and an unsaved external
// preview, so the client doesn't need two parsers. `_id` is set for
// anything already in the catalog (System/Custom/previously-cached
// External); `externalRef` is set only for a not-yet-persisted OFF result —
// logging one of those triggers ensureExternalFoodPersisted to mint a real
// `_id` before the log is written.
export type UnifiedFoodResult = {
	_id: string | null;
	externalRef: { source: "OpenFoodFacts"; id: string } | null;
	name: string;
	brand: string | null;
	source: string;
	basePer: number;
	servingLabel: string;
	servings: { label: string; gramsPerUnit: number; isDefault: boolean }[];
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG: number | null;
	sugarG: number | null;
	isVeg?: boolean;
	allergens: string[];
	imageUrl: string | null;
	barcode: string | null;
};

const fromLocal = (
	food: HydratedDocument<NutritionFoodDocument>,
): UnifiedFoodResult => ({
	_id: food._id.toString(),
	externalRef: null,
	name: food.name,
	brand: food.brand ?? null,
	source: food.source,
	basePer: food.basePer,
	servingLabel: food.servingLabel,
	servings: (food.servings ?? []).map((s) => ({
		label: s.label,
		gramsPerUnit: s.gramsPerUnit,
		isDefault: s.isDefault ?? false,
	})),
	caloriesKcal: food.caloriesKcal,
	proteinG: food.proteinG,
	carbsG: food.carbsG,
	fatG: food.fatG,
	fiberG: food.fiberG ?? null,
	sugarG: food.sugarG ?? null,
	isVeg: food.isVeg ?? undefined,
	allergens: food.allergens ?? [],
	imageUrl: food.imageUrl ?? null,
	barcode: food.barcode ?? null,
});

const fromExternalPreview = (dto: ExternalFoodDto): UnifiedFoodResult => ({
	_id: null,
	externalRef: { source: "OpenFoodFacts", id: dto.externalId },
	name: dto.name,
	brand: dto.brand,
	source: "External",
	basePer: 100,
	servingLabel: "100 g",
	servings: dto.servings,
	caloriesKcal: dto.caloriesKcal,
	proteinG: dto.proteinG,
	carbsG: dto.carbsG,
	fatG: dto.fatG,
	fiberG: dto.fiberG,
	sugarG: dto.sugarG,
	isVeg: dto.isVeg,
	allergens: dto.allergens,
	imageUrl: dto.imageUrl,
	barcode: dto.barcode,
});

export type SearchFoodsUnifiedOptions = {
	query: string;
	page?: number;
	limit?: number;
	actor: NutritionActor;
};

export const searchFoodsUnified = async (
	options: SearchFoodsUnifiedOptions,
): Promise<{ items: UnifiedFoodResult[]; page: number; limit: number }> => {
	const page = Math.max(1, options.page ?? 1);
	const limit = Math.min(50, Math.max(1, options.limit ?? 20));

	const [localResult, externalDtos] = await Promise.all([
		searchFoods({
			query: options.query,
			page,
			limit,
			// Users see system + previously-cached external foods; staff see
			// system + their own custom foods (unchanged catalog-management view).
			...(options.actor.role === "user"
				? {
						source: [NutritionFoodSource.System, NutritionFoodSource.External],
					}
				: { systemAndOwner: options.actor.id }),
		}),
		searchOff(options.query, page, limit),
	]);

	const localBarcodes = new Set(
		localResult.items.map((f) => f.barcode).filter((b): b is string => !!b),
	);

	const localViews = localResult.items.map(fromLocal);
	// Dedupe: an external hit whose barcode already exists locally (System,
	// Custom, or already-cached External) is dropped rather than shown twice.
	const externalViews = externalDtos
		.filter((dto) => !dto.barcode || !localBarcodes.has(dto.barcode))
		.map(fromExternalPreview);

	return {
		items: [...localViews, ...externalViews],
		page,
		limit,
	};
};

export const lookupBarcode = async (
	code: string,
): Promise<UnifiedFoodResult | null> => {
	// Local always wins — a nutritionist's manual correction to a barcode
	// must never be shadowed by a live OFF lookup.
	const local = await NutritionFood.findOne({ barcode: code, isActive: true });
	if (local) return fromLocal(local);

	const dto = await lookupOffBarcode(code);
	return dto ? fromExternalPreview(dto) : null;
};

export type EnsureExternalFoodInput = {
	source: "OpenFoodFacts";
	id: string;
};

// Cache-on-log: the first member to log an external food persists it into
// the catalog with a real _id. $setOnInsert (not $set) so a nutritionist who
// later corrects the macros on this row isn't silently overwritten the next
// time someone logs the same barcode.
export const ensureExternalFoodPersisted = async (
	ref: EnsureExternalFoodInput,
): Promise<HydratedDocument<NutritionFoodDocument>> => {
	const existing = await NutritionFood.findOne({
		externalSource: ref.source,
		externalId: ref.id,
	});
	if (existing) return existing;

	const dto = await lookupOffBarcode(ref.id);
	if (!dto) {
		throw new NutritionServiceError(
			"NOT_FOUND",
			`External food not found: ${ref.source}/${ref.id}`,
		);
	}

	const doc = await NutritionFood.findOneAndUpdate(
		{ externalSource: ref.source, externalId: ref.id },
		{
			$setOnInsert: {
				name: dto.name,
				brand: dto.brand,
				source: NutritionFoodSource.External,
				basePer: 100,
				servingLabel: "100 g",
				servings: dto.servings,
				caloriesKcal: dto.caloriesKcal,
				proteinG: dto.proteinG,
				carbsG: dto.carbsG,
				fatG: dto.fatG,
				fiberG: dto.fiberG,
				sugarG: dto.sugarG,
				micros: dto.micros,
				barcode: dto.barcode,
				isActive: true,
				isVeg: dto.isVeg,
				allergens: dto.allergens,
				externalSource: ref.source,
				externalId: ref.id,
				imageUrl: dto.imageUrl,
			},
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	);

	if (!doc) {
		throw new NutritionServiceError(
			"BAD_REQUEST",
			"Failed to persist external food",
		);
	}
	return doc;
};
