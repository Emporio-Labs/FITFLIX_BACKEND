import { NutritionFoodSource } from "../../models/Enums";
import NutritionFood from "../../models/nutrition-food.model";
import type { NutritionActor } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";

export type FoodInput = {
	name: string;
	brand?: string | null;
	basePer?: number;
	servingLabel?: string;
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG?: number | null;
	sugarG?: number | null;
	barcode?: string | null;
};

export type FoodSearchOptions = {
	query?: string;
	source?: NutritionFoodSource;
	createdBy?: string;
	// When set, restricts results to system foods + this owner's custom
	// foods (the nutritionist catalog view).
	systemAndOwner?: string;
	page?: number;
	limit?: number;
};

export const createFood = async (
	input: FoodInput,
	createdBy: string,
	source: NutritionFoodSource,
) => {
	const ownerId =
		source === NutritionFoodSource.Custom
			? toObjectId(createdBy, "BAD_REQUEST", "Invalid creator ID")
			: null;

	return NutritionFood.create({
		...input,
		source,
		createdBy: ownerId,
	});
};

export const searchFoods = async (options: FoodSearchOptions) => {
	const page = Math.max(1, options.page ?? 1);
	const limit = Math.min(100, Math.max(1, options.limit ?? 20));

	const filter: Record<string, unknown> = { isActive: true };

	if (options.source) {
		filter.source = options.source;
	}

	if (options.createdBy) {
		filter.createdBy = toObjectId(
			options.createdBy,
			"BAD_REQUEST",
			"Invalid creator ID",
		);
	}

	if (options.systemAndOwner) {
		const ownerId = toObjectId(
			options.systemAndOwner,
			"BAD_REQUEST",
			"Invalid creator ID",
		);
		filter.$or = [
			{ source: NutritionFoodSource.System },
			{ source: NutritionFoodSource.Custom, createdBy: ownerId },
		];
	}

	if (options.query && options.query.trim()) {
		filter.$text = { $search: options.query.trim() };
	}

	const [items, total] = await Promise.all([
		NutritionFood.find(filter)
			.sort({ name: 1 })
			.skip((page - 1) * limit)
			.limit(limit),
		NutritionFood.countDocuments(filter),
	]);

	return { items, total, page, limit };
};

const loadOwnedFood = async (foodId: string, actor: NutritionActor) => {
	const id = toObjectId(foodId, "NOT_FOUND", "Food not found");
	const food = await NutritionFood.findById(id);

	if (!food) {
		throw new NutritionServiceError("NOT_FOUND", "Food not found");
	}

	if (actor.role === "admin") {
		return food;
	}

	const isOwnCustom =
		food.source === NutritionFoodSource.Custom &&
		food.createdBy?.toString() === actor.id;

	if (!isOwnCustom) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"You can only modify your own custom foods",
		);
	}

	return food;
};

export const updateFood = async (
	foodId: string,
	patch: Partial<FoodInput>,
	actor: NutritionActor,
) => {
	const food = await loadOwnedFood(foodId, actor);
	food.set(patch);
	await food.save();
	return food;
};

export const deactivateFood = async (
	foodId: string,
	actor: NutritionActor,
) => {
	const food = await loadOwnedFood(foodId, actor);
	food.set({ isActive: false });
	await food.save();
	return food;
};
