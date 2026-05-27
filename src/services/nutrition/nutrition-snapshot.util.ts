import NutritionFood from "../../models/nutrition-food.model";
import type { DayInput, MealItemInput } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import { scaleMacros, sumMacros } from "./nutrition-macro.util";

// Resolves a flat list of {foodId, quantityG} into immutable macro
// snapshots — used by meal logging.
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
				timeOfDay: meal.timeOfDay ?? (meal as { suggestedTime?: string | null }).suggestedTime ?? null,
				notes: meal.notes ?? "",
				items,
				options,
			};
		}),
	}));
};
