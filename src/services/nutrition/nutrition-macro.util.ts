import type {
	MacroSnapshot,
	MacroTotals,
	ScalableFood,
} from "../../types/nutrition";

const round = (value: number): number => Math.round(value * 100) / 100;

// Single source of macro math. Catalog macros are per `basePer` grams;
// every consumer scales through here so values stay consistent.
export const scaleMacros = (
	food: ScalableFood,
	quantityG: number,
): MacroSnapshot => {
	const base = food.basePer > 0 ? food.basePer : 100;
	const factor = quantityG / base;

	return {
		caloriesKcal: round(food.caloriesKcal * factor),
		proteinG: round(food.proteinG * factor),
		carbsG: round(food.carbsG * factor),
		fatG: round(food.fatG * factor),
		fiberG:
			food.fiberG === null || food.fiberG === undefined
				? null
				: round(food.fiberG * factor),
		sugarG:
			food.sugarG === null || food.sugarG === undefined
				? null
				: round(food.sugarG * factor),
	};
};

export const sumMacros = (
	items: ReadonlyArray<{
		caloriesKcal: number;
		proteinG: number;
		carbsG: number;
		fatG: number;
		fiberG?: number | null;
		sugarG?: number | null;
	}>,
): MacroTotals => {
	const totals: MacroTotals = {
		caloriesKcal: 0,
		proteinG: 0,
		carbsG: 0,
		fatG: 0,
		fiberG: 0,
		sugarG: 0,
	};

	for (const item of items) {
		totals.caloriesKcal += item.caloriesKcal;
		totals.proteinG += item.proteinG;
		totals.carbsG += item.carbsG;
		totals.fatG += item.fatG;
		totals.fiberG += item.fiberG ?? 0;
		totals.sugarG += item.sugarG ?? 0;
	}

	return {
		caloriesKcal: round(totals.caloriesKcal),
		proteinG: round(totals.proteinG),
		carbsG: round(totals.carbsG),
		fatG: round(totals.fatG),
		fiberG: round(totals.fiberG),
		sugarG: round(totals.sugarG),
	};
};
