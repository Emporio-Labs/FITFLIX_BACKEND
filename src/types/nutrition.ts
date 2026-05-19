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

export type MealInput = {
	mealType: string;
	name: string;
	timeOfDay?: string | null;
	notes?: string;
	items: MealItemInput[];
};

export type DayInput = {
	dayNumber: number;
	meals: MealInput[];
};

// The acting principal passed from controllers into services so the service
// layer can enforce ownership/role rules without touching Express.
export type NutritionActor = Pick<AuthenticatedUser, "id" | "role">;
