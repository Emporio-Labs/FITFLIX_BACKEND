import mongoose from "mongoose";
import NutritionFood from "../../models/nutrition-food.model";
import NutritionProfile from "../../models/nutrition-profile.model";
import NutritionTemplate from "../../models/nutrition-template.model";
import { NutritionPlanStatus } from "../../models/Enums";
import type { NutritionActor } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import {
	type FilterableFood,
	filterFoodsByProfile,
} from "./nutrition-filter.service";
import { getTemplate } from "./nutrition-template.service";

// Returns Active templates scored by compatibility with the user's nutrition profile.
export const recommendTemplatesForUser = async (
	userId: string,
	actor: NutritionActor,
) => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");

	const profile = await NutritionProfile.findOne({ userId: userObjectId });
	if (!profile) {
		throw new NutritionServiceError(
			"NOT_FOUND",
			"User has no nutrition profile — create one first",
		);
	}

	const templates = await NutritionTemplate.find({
		status: NutritionPlanStatus.Active,
		goal: profile.goal,
	}).sort({ updatedAt: -1 });

	return {
		profile: { goal: profile.goal, dietaryPreference: profile.dietaryPreference },
		matchedOn: ["goal"],
		templates,
	};
};

export type FilterProfileInlineInput = {
	dietaryPreference?: string;
	allergies?: string[];
	dislikedFoods?: string[];
	goal?: string;
};

// Gathers all foodIds from a template's items + options[].foods, loads them,
// then applies the rules-based filter against a profile (by userId or inline).
export const filterTemplateFoods = async (
	templateId: string,
	actor: NutritionActor,
	opts: { userId?: string; profile?: FilterProfileInlineInput },
) => {
	const template = await getTemplate(templateId, actor);

	const foodIdSet = new Set<string>();
	for (const day of template.days) {
		for (const meal of day.meals) {
			for (const item of meal.items ?? []) {
				foodIdSet.add(item.foodId.toString());
			}
			for (const opt of (meal as { options?: Array<{ foods?: Array<{ foodId: mongoose.Types.ObjectId }> }> }).options ?? []) {
				for (const item of opt.foods ?? []) {
					foodIdSet.add(item.foodId.toString());
				}
			}
		}
	}

	const foodObjectIds = Array.from(foodIdSet).map(
		(id) => new mongoose.Types.ObjectId(id),
	);
	const foods = await NutritionFood.find({
		_id: { $in: foodObjectIds },
	}).lean();

	let filterInput: FilterProfileInlineInput;

	if (opts.userId) {
		const userObjectId = toObjectId(
			opts.userId,
			"BAD_REQUEST",
			"Invalid user ID",
		);
		const profile = await NutritionProfile.findOne({
			userId: userObjectId,
		});
		if (!profile) {
			throw new NutritionServiceError(
				"NOT_FOUND",
				"User has no nutrition profile",
			);
		}
		filterInput = {
			dietaryPreference: profile.dietaryPreference,
			allergies: profile.allergies as string[],
			dislikedFoods: profile.dislikedFoods as string[],
			goal: profile.goal,
		};
	} else if (opts.profile) {
		filterInput = opts.profile;
	} else {
		throw new NutritionServiceError(
			"BAD_REQUEST",
			"Provide either userId or an inline profile for filtering",
		);
	}

	const filterableFoods: FilterableFood[] = foods.map((f) => ({
		_id: f._id,
		name: f.name,
		// isVeg stored as Boolean (null possible) — convert null → undefined
		isVeg: f.isVeg ?? undefined,
		allergens: f.allergens as string[] | undefined,
		carbsG: f.carbsG,
	}));

	return filterFoodsByProfile(filterableFoods, filterInput);
};
