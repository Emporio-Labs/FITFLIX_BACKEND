/**
 * Whitelist of micronutrient keys tracked on NutritionFood.micros and
 * NutritionMealLog item/day micros. Kept as a standalone constant (no
 * service imports) so both the OFF adapter and the food validator can
 * depend on it without crossing the validator -> service layering boundary.
 */
export const MICRO_KEYS = [
	"sodiumMg",
	"potassiumMg",
	"calciumMg",
	"ironMg",
	"vitaminAUg",
	"vitaminCMg",
	"cholesterolMg",
	"saturatedFatG",
] as const;

export type MicroKey = (typeof MICRO_KEYS)[number];
