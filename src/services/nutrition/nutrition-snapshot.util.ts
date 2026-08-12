import type { HydratedDocument } from "mongoose";
import NutritionFood, {
	type NutritionFoodDocument,
} from "../../models/nutrition-food.model";
import type {
	DayInput,
	LogItemInput,
	MealItemInput,
} from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import { ensureExternalFoodPersisted } from "./nutrition-external-food.service";
import {
	resolveQuantityG,
	scaleMacros,
	scaleMicros,
	sumMacros,
} from "./nutrition-macro.util";

// Resolves a flat list of {foodId, quantityG} into immutable macro
// snapshots — used by template/plan authoring (resolveDaysToSnapshots
// below) and by markMealCompleted, which always references a catalog food.
export const resolveItemsToSnapshots = async (items: MealItemInput[]) => {
	const objectIds = items.map((item) =>
		toObjectId(item.foodId, "BAD_REQUEST", `Invalid food ID: ${item.foodId}`),
	);
	const foods = await NutritionFood.find({ _id: { $in: objectIds } });
	const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

	return items.map((item) => {
		const food = foodMap.get(item.foodId);
		if (!food) {
			throw new NutritionServiceError(
				"BAD_REQUEST",
				`Food not found: ${item.foodId}`,
			);
		}

		const macros = scaleMacros(
			{
				basePer: food.basePer,
				caloriesKcal: food.caloriesKcal,
				proteinG: food.proteinG,
				carbsG: food.carbsG,
				fatG: food.fatG,
				fiberG: food.fiberG,
				sugarG: food.sugarG,
			},
			item.quantityG,
		);

		return {
			foodId: food._id,
			foodName: food.name,
			quantityG: item.quantityG,
			...macros,
		};
	});
};

// Resolves DayInput (foodId + quantity) into fully snapshotted embedded
// days. Snapshots are immutable — a later catalog edit must not change a
// template or assigned plan, so macros are frozen here.
// Also resolves options[].foods alongside items[] for multi-option meals.
export const resolveDaysToSnapshots = async (days: DayInput[]) => {
	const foodIds = new Set<string>();
	for (const day of days) {
		for (const meal of day.meals) {
			for (const item of meal.items ?? []) {
				foodIds.add(item.foodId);
			}
			for (const opt of meal.options ?? []) {
				for (const item of opt.foods ?? []) {
					foodIds.add(item.foodId);
				}
			}
		}
	}

	const objectIds = Array.from(foodIds).map((id) =>
		toObjectId(id, "BAD_REQUEST", `Invalid food ID: ${id}`),
	);

	const foods = await NutritionFood.find({ _id: { $in: objectIds } });
	const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

	const snapshotItem = (item: MealItemInput) => {
		const food = foodMap.get(item.foodId);
		if (!food) {
			throw new NutritionServiceError(
				"BAD_REQUEST",
				`Food not found: ${item.foodId}`,
			);
		}

		const macros = scaleMacros(
			{
				basePer: food.basePer,
				caloriesKcal: food.caloriesKcal,
				proteinG: food.proteinG,
				carbsG: food.carbsG,
				fatG: food.fatG,
				fiberG: food.fiberG,
				sugarG: food.sugarG,
			},
			item.quantityG,
		);

		return {
			foodId: food._id,
			foodName: food.name,
			quantityG: item.quantityG,
			...macros,
		};
	};

	return days.map((day) => ({
		dayNumber: day.dayNumber,
		meals: day.meals.map((meal) => {
			const items = (meal.items ?? []).map(snapshotItem);

			const options = (meal.options ?? []).map((opt) => {
				const foods = (opt.foods ?? []).map(snapshotItem);
				return {
					title: opt.title,
					isDefault: opt.isDefault ?? false,
					reasoning: opt.reasoning ?? "",
					foods,
					macros: sumMacros(foods),
				};
			});

			return {
				mealType: meal.mealType,
				name: meal.name,
				// suggestedTime is a validator-layer alias for timeOfDay
				timeOfDay:
					meal.timeOfDay ??
					(meal as { suggestedTime?: string | null }).suggestedTime ??
					null,
				notes: meal.notes ?? "",
				items,
				options,
			};
		}),
	}));
};

// Resolves meal-log items — each one either a catalog food, an external
// (not-yet-cached) food, or fully free-text with caller-supplied macros.
// Catalog/external items still flow through scaleMacros with grams derived
// from quantityG or a household serving (resolveQuantityG); free-text items
// trust the supplied macros verbatim since there's no catalog row to scale
// from.
export const resolveLogItemsToSnapshots = async (items: LogItemInput[]) => {
	// Pass 1: turn any externalRef into a real foodId, caching the food into
	// the catalog on first log (ensureExternalFoodPersisted).
	const resolvedFoodIds = await Promise.all(
		items.map((item) => {
			if (item.externalRef) {
				return ensureExternalFoodPersisted(item.externalRef).then((food) =>
					food._id.toString(),
				);
			}
			return Promise.resolve(item.foodId ?? null);
		}),
	);

	const uniqueIds = Array.from(
		new Set(resolvedFoodIds.filter((id): id is string => id !== null)),
	).map((id) => toObjectId(id, "BAD_REQUEST", `Invalid food ID: ${id}`));

	const foods =
		uniqueIds.length > 0
			? await NutritionFood.find({ _id: { $in: uniqueIds } })
			: [];
	const foodMap = new Map<string, HydratedDocument<NutritionFoodDocument>>(
		foods.map((f) => [f._id.toString(), f]),
	);

	return items.map((item, index) => {
		if (item.foodName) {
			if (item.quantityG === undefined) {
				throw new NutritionServiceError(
					"BAD_REQUEST",
					"quantityG is required for free-text items",
				);
			}
			return {
				foodId: null,
				foodName: item.foodName,
				quantityG: item.quantityG,
				caloriesKcal: item.caloriesKcal ?? 0,
				proteinG: item.proteinG ?? 0,
				carbsG: item.carbsG ?? 0,
				fatG: item.fatG ?? 0,
				fiberG: item.fiberG ?? null,
				sugarG: item.sugarG ?? null,
				servingLabel: item.servingLabel ?? null,
				servingCount: item.servingCount ?? null,
				// No catalog food to source micros from for a free-text item.
				micros: {},
			};
		}

		const foodId = resolvedFoodIds[index];
		const food = foodId ? foodMap.get(foodId) : undefined;
		if (!food) {
			throw new NutritionServiceError(
				"BAD_REQUEST",
				`Food not found: ${item.foodId ?? item.externalRef?.id}`,
			);
		}

		const quantityG = resolveQuantityG(food, {
			servingLabel: item.servingLabel,
			servingCount: item.servingCount,
			quantityG: item.quantityG,
		});

		const macros = scaleMacros(
			{
				basePer: food.basePer,
				caloriesKcal: food.caloriesKcal,
				proteinG: food.proteinG,
				carbsG: food.carbsG,
				fatG: food.fatG,
				fiberG: food.fiberG,
				sugarG: food.sugarG,
			},
			quantityG,
		);
		const micros = scaleMicros(food, quantityG);

		return {
			foodId: food._id,
			foodName: food.name,
			quantityG,
			...macros,
			servingLabel: item.servingLabel ?? null,
			servingCount: item.servingCount ?? null,
			micros,
		};
	});
};
