import type { AuthenticatedUser } from "./auth";

// Macro snapshot scaled to a concrete portion (grams). Stored immutably on
// template/plan/log items so historical data never mutates.
export type MacroSnapshot = {
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG: number | null;
	sugarG: number | null;
};

export type MacroTotals = {
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG: number;
	sugarG: number;
};

// Minimal canonical-macro shape required to scale a portion.
export type ScalableFood = {
	basePer: number;
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG?: number | null;
	sugarG?: number | null;
};

export type MealItemInput = {
	foodId: string;
	quantityG: number;
};

// A meal-log item, as accepted by POST/PATCH /nutrition/my/meal-logs —
// deliberately looser than MealItemInput (used by template/plan authoring).
// Exactly one of foodId / externalRef / foodName identifies the food;
// quantityG is either given directly or derived from a household serving.
export type LogItemInput = {
	foodId?: string;
	externalRef?: { source: "OpenFoodFacts"; id: string };
	foodName?: string;
	caloriesKcal?: number;
	proteinG?: number;
	carbsG?: number;
	fatG?: number;
	fiberG?: number | null;
	sugarG?: number | null;
	quantityG?: number;
	servingLabel?: string;
	servingCount?: number;
	recipeSource?: string;
};

export type MealOptionInput = {
	title: string;
	isDefault?: boolean;
	reasoning?: string;
	foods: MealItemInput[];
};

export type MealInput = {
	mealType: string;
	name: string;
	timeOfDay?: string | null;
	suggestedTime?: string | null;
	notes?: string;
	items: MealItemInput[];
	options?: MealOptionInput[];
};

export type DayInput = {
	dayNumber: number;
	meals: MealInput[];
};

// The acting principal passed from controllers into services so the service
// layer can enforce ownership/role rules without touching Express.
export type NutritionActor = Pick<AuthenticatedUser, "id" | "role">;
