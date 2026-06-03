import { copyDayStructureSchema } from "../src/validators/nutrition-plan.validator";
import { markMealCompletedBodySchema } from "../src/validators/nutrition-meal-log.validator";

console.log("=== Testing Validation Schemas ===");

// 1. Test copyDayStructureSchema
console.log("\nTesting copyDayStructureSchema:");
const validCopyPayload = {
  planId: "60a7e1c8d8b99c001f3e2b10",
  sourceDayOfWeek: "Monday",
  targetDaysOfWeek: ["Wednesday", "Friday"],
  strategy: "replicate"
};
const parsedCopyValid = copyDayStructureSchema.safeParse(validCopyPayload);
console.log("Valid Copy Payload:", parsedCopyValid.success ? "PASSED (OK)" : "FAILED");

const invalidCopyPayload = {
  planId: "invalid-id-format",
  sourceDayOfWeek: "InvalidDay",
  targetDaysOfWeek: ["Monday"],
  strategy: "invalid-strategy"
};
const parsedCopyInvalid = copyDayStructureSchema.safeParse(invalidCopyPayload);
console.log("Invalid Copy Payload: Success? ", parsedCopyInvalid.success);
if (!parsedCopyInvalid.success) {
  console.log("Errors captured as expected:");
  console.log(JSON.stringify(parsedCopyInvalid.error.format(), null, 2));
}

// 2. Test markMealCompletedBodySchema
console.log("\nTesting markMealCompletedBodySchema:");
const validCompletePayload = {
  dayNumber: 1,
  mealIndex: 3,
  completedOptionId: "60a7e1c8d8b99c001f3e2b11"
};
const parsedCompleteValid = markMealCompletedBodySchema.safeParse(validCompletePayload);
console.log("Valid Complete Payload:", parsedCompleteValid.success ? "PASSED (OK)" : "FAILED");

const invalidCompletePayload = {
  dayNumber: "not-a-number",
  mealIndex: "NaN",
  completedOptionId: "short-id"
};
const parsedCompleteInvalid = markMealCompletedBodySchema.safeParse(invalidCompletePayload);
console.log("Invalid Complete Payload: Success? ", parsedCompleteInvalid.success);
if (!parsedCompleteInvalid.success) {
  console.log("Errors captured as expected:");
  console.log(JSON.stringify(parsedCompleteInvalid.error.format(), null, 2));
}
