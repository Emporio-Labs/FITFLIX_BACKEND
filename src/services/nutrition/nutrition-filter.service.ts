import { DietaryPreference, NutritionGoal } from "../../models/Enums";

export type FilterableFood = {
	_id: unknown;
	name: string;
	isVeg?: boolean;
	allergens?: string[];
	carbsG: number;
};

export type FilterProfileInput = {
	dietaryPreference?: string;
	allergies?: string[];
	dislikedFoods?: string[];
	goal?: string;
};

export type FilterResult<T> = {
	included: T[];
	excluded: Array<{ food: T; reason: string }>;
};

const LOW_CARB_GOALS = new Set<string>([NutritionGoal.WeightLoss, NutritionGoal.Medical]);
const norm = (s: string) => s.trim().toLowerCase();

// Pure, synchronous, rules-based filter engine. No AI.
// Rules applied in order:
//   1. Veg/Vegan → exclude foods where isVeg===false (undefined = unknown, kept)
//   2. Allergy   → exclude when food.allergens intersects profile.allergies
//   3. Disliked  → exclude by exact name match
//   4. Low-carb goal → stable sort included foods by carbsG asc
export const filterFoodsByProfile = <T extends FilterableFood>(
	foods: T[],
	profile: FilterProfileInput,
): FilterResult<T> => {
	const allergySet = new Set((profile.allergies ?? []).map(norm));
	const dislikedSet = new Set((profile.dislikedFoods ?? []).map(norm));
	const isVegOrVegan =
		profile.dietaryPreference === DietaryPreference.Veg ||
		profile.dietaryPreference === DietaryPreference.Vegan;

	const included: T[] = [];
	const excluded: FilterResult<T>["excluded"] = [];

	for (const food of foods) {
		if (isVegOrVegan && food.isVeg === false) {
			excluded.push({ food, reason: "dietary_preference" });
			continue;
		}
		if ((food.allergens ?? []).some((a) => allergySet.has(norm(a)))) {
			excluded.push({ food, reason: "allergen" });
			continue;
		}
		if (dislikedSet.has(norm(food.name))) {
			excluded.push({ food, reason: "disliked" });
			continue;
		}
		included.push(food);
	}

	if (profile.goal && LOW_CARB_GOALS.has(profile.goal)) {
		included.sort((a, b) => (a.carbsG ?? 0) - (b.carbsG ?? 0));
	}

	return { included, excluded };
};
