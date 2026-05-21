import mongoose from "mongoose";
import { NutritionPlanStatus } from "../../models/Enums";
import type { NutritionGoal } from "../../models/Enums";
import NutritionFood from "../../models/nutrition-food.model";
import NutritionProfile from "../../models/nutrition-profile.model";
import NutritionTemplate from "../../models/nutrition-template.model";
import UserNutritionPlan, {
	type UserNutritionPlanDocument,
} from "../../models/nutrition-plan.model";
import type { DayInput, NutritionActor } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import { resolveDaysToSnapshots } from "./nutrition-snapshot.util";

export type AllergenWarning = {
	dayNumber: number;
	mealName: string;
	foodId: string;
	foodName: string;
	matchedAllergens: string[];
};

const norm = (s: string) => s.trim().toLowerCase();

type FoodItemLike = { foodId: unknown; foodName: string };
type MealLike = {
	name?: string;
	items?: FoodItemLike[];
	options?: Array<{ foods?: FoodItemLike[] }>;
};
type DayLike = { dayNumber: number; meals?: MealLike[] };

// Scan a plan's snapshotted days against the user's profile allergies and
// return any food matches. Non-blocking by design — assignment proceeds and
// the response surfaces warnings for the nutritionist to review.
const collectAllergenWarnings = async (
	userId: string,
	days: DayLike[],
): Promise<AllergenWarning[]> => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const profile = await NutritionProfile.findOne({ userId: userObjectId })
		.select("allergies")
		.lean();
	const allergies = (profile?.allergies ?? []) as string[];
	if (allergies.length === 0) return [];
	const allergySet = new Set(allergies.map(norm));

	const foodIds = new Set<string>();
	for (const day of days) {
		for (const meal of day.meals ?? []) {
			for (const item of meal.items ?? []) {
				if (item.foodId) foodIds.add(String(item.foodId));
			}
			for (const opt of meal.options ?? []) {
				for (const item of opt.foods ?? []) {
					if (item.foodId) foodIds.add(String(item.foodId));
				}
			}
		}
	}
	if (foodIds.size === 0) return [];

	const foods = await NutritionFood.find({ _id: { $in: [...foodIds] } })
		.select("_id allergens")
		.lean();
	const allergensByFood = new Map<string, string[]>();
	for (const food of foods) {
		allergensByFood.set(
			String(food._id),
			((food.allergens ?? []) as string[]).filter((a) =>
				allergySet.has(norm(a)),
			),
		);
	}

	const warnings: AllergenWarning[] = [];
	const visit = (day: DayLike, meal: MealLike, item: FoodItemLike) => {
		const foodIdStr = String(item.foodId);
		const matched = allergensByFood.get(foodIdStr) ?? [];
		if (matched.length > 0) {
			warnings.push({
				dayNumber: day.dayNumber,
				mealName: meal.name ?? "",
				foodId: foodIdStr,
				foodName: item.foodName,
				matchedAllergens: matched,
			});
		}
	};

	for (const day of days) {
		for (const meal of day.meals ?? []) {
			for (const item of meal.items ?? []) visit(day, meal, item);
			for (const opt of meal.options ?? []) {
				for (const item of opt.foods ?? []) visit(day, meal, item);
			}
		}
	}
	return warnings;
};

const MEMBER_POPULATE = { path: "userId", select: "username email phone" };

export type AssignOptions = {
	startDate: Date;
	endDate?: Date | null;
};

export type LifestyleRecommendationInput = {
	title: string;
	description?: string;
	category?: string;
};

export type AdHocPlanInput = {
	name: string;
	goal: NutritionGoal;
	startDate: Date;
	endDate?: Date | null;
	targetCaloriesKcal?: number | null;
	targetMacros?: {
		proteinG?: number | null;
		carbsG?: number | null;
		fatG?: number | null;
		fiberG?: number | null;
		sugarG?: number | null;
	};
	durationDays?: number;
	days?: DayInput[];
	lifestyleRecommendations?: LifestyleRecommendationInput[];
};

export type PlanListFilters = {
	status?: NutritionPlanStatus;
};

// Deep, value-only copy of the template's embedded days so the assigned
// plan is fully detached from the template document.
const cloneDays = (days: unknown): UserNutritionPlanDocument["days"] =>
	JSON.parse(
		JSON.stringify(days ?? []),
	) as UserNutritionPlanDocument["days"];

export const assignTemplateToUser = async (
	templateId: string,
	userId: string,
	actor: NutritionActor,
	options: AssignOptions,
) => {
	const tplId = toObjectId(templateId, "NOT_FOUND", "Template not found");
	const template = await NutritionTemplate.findById(tplId);

	if (!template) {
		throw new NutritionServiceError("NOT_FOUND", "Template not found");
	}

	if (
		actor.role !== "admin" &&
		template.createdBy.toString() !== actor.id
	) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"You can only assign your own templates",
		);
	}

	const clonedDays = cloneDays(template.days);

	const doc = await UserNutritionPlan.create({
		userId: toObjectId(userId, "BAD_REQUEST", "Invalid user ID"),
		nutritionistId: toObjectId(
			actor.id,
			"BAD_REQUEST",
			"Invalid nutritionist ID",
		),
		sourceTemplateId: template._id,
		name: template.name,
		goal: template.goal,
		startDate: options.startDate,
		endDate: options.endDate ?? null,
		targetCaloriesKcal: template.targetCaloriesKcal,
		targetMacros: template.targetMacros ?? {},
		durationDays: template.durationDays,
		days: clonedDays,
		lifestyleRecommendations: JSON.parse(
			JSON.stringify(template.lifestyleRecommendations ?? []),
		),
	});

	const plan = await UserNutritionPlan.findById(doc._id)
		.populate(MEMBER_POPULATE)
		.lean();
	const warnings = await collectAllergenWarnings(
		userId,
		clonedDays as unknown as DayLike[],
	);
	return { plan, warnings };
};

export const createAdHocPlan = async (
	input: AdHocPlanInput,
	userId: string,
	nutritionistId: string,
) => {
	const days = input.days ? await resolveDaysToSnapshots(input.days) : [];

	const doc = await UserNutritionPlan.create({
		userId: toObjectId(userId, "BAD_REQUEST", "Invalid user ID"),
		nutritionistId: toObjectId(
			nutritionistId,
			"BAD_REQUEST",
			"Invalid nutritionist ID",
		),
		sourceTemplateId: null,
		name: input.name,
		goal: input.goal,
		startDate: input.startDate,
		endDate: input.endDate ?? null,
		targetCaloriesKcal: input.targetCaloriesKcal ?? null,
		targetMacros: input.targetMacros ?? {},
		durationDays: input.durationDays ?? 7,
		days,
		lifestyleRecommendations: input.lifestyleRecommendations ?? [],
	});

	const plan = await UserNutritionPlan.findById(doc._id)
		.populate(MEMBER_POPULATE)
		.lean();
	const warnings = await collectAllergenWarnings(
		userId,
		days as unknown as DayLike[],
	);
	return { plan, warnings };
};

export const listUserPlans = async (
	userId: string,
	filters: PlanListFilters,
) => {
	const id = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const filter: Record<string, unknown> = { userId: id };
	if (filters.status) {
		filter.status = filters.status;
	}
	return UserNutritionPlan.find(filter)
		.sort({ startDate: -1 })
		.populate(MEMBER_POPULATE)
		.lean();
};

export const listNutritionistPlans = async (
	nutritionistId: string,
	filters: PlanListFilters,
) => {
	const id = toObjectId(
		nutritionistId,
		"BAD_REQUEST",
		"Invalid nutritionist ID",
	);
	const filter: Record<string, unknown> = { nutritionistId: id };
	if (filters.status) {
		filter.status = filters.status;
	}
	return UserNutritionPlan.find(filter)
		.sort({ updatedAt: -1 })
		.populate(MEMBER_POPULATE)
		.lean();
};

// Authorization: the owning user, the assigning nutritionist, or any admin.
export const getPlan = async (planId: string, actor: NutritionActor) => {
	const id = toObjectId(planId, "NOT_FOUND", "Plan not found");
	const plan = await UserNutritionPlan.findById(id).populate(
		MEMBER_POPULATE,
	);

	if (!plan) {
		throw new NutritionServiceError("NOT_FOUND", "Plan not found");
	}

	const rawUserId = plan.userId as unknown;
	const ownerUserId =
		rawUserId && typeof rawUserId === "object" && "_id" in rawUserId
			? String((rawUserId as { _id: unknown })._id)
			: String(rawUserId);
	const isOwnerUser = actor.role === "user" && ownerUserId === actor.id;
	const isAssigningNutritionist =
		actor.role === "nutritionist" &&
		plan.nutritionistId.toString() === actor.id;
	const isAdmin = actor.role === "admin";

	if (!isOwnerUser && !isAssigningNutritionist && !isAdmin) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"You do not have access to this plan",
		);
	}

	return plan;
};

const loadManagedPlan = async (planId: string, actor: NutritionActor) => {
	const plan = await getPlan(planId, actor);

	if (actor.role === "user") {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"Users cannot modify plan content",
		);
	}

	return plan;
};

export const updatePlan = async (
	planId: string,
	patch: Partial<AdHocPlanInput>,
	actor: NutritionActor,
) => {
	const plan = await loadManagedPlan(planId, actor);

	const { days, ...rest } = patch;
	plan.set(rest);

	if (days) {
		plan.set({ days: await resolveDaysToSnapshots(days) });
	}

	await plan.save();
	await plan.populate(MEMBER_POPULATE);
	return plan;
};

export const setPlanStatus = async (
	planId: string,
	status: NutritionPlanStatus,
	actor: NutritionActor,
) => {
	const plan = await loadManagedPlan(planId, actor);
	plan.set({ status });
	await plan.save();
	await plan.populate(MEMBER_POPULATE);
	return plan;
};

export type DuplicatePlanOptions = {
	targetUserId?: string;
	name?: string;
};

// Deep-clones an existing plan into a new Draft plan. Reuses the same
// JSON round-trip clone as assignTemplateToUser so options/lifestyle data
// is correctly deep-copied.
export const duplicatePlan = async (
	planId: string,
	actor: NutritionActor,
	opts: DuplicatePlanOptions = {},
) => {
	const source = await getPlan(planId, actor);

	if (actor.role === "user") {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"Users cannot duplicate plans",
		);
	}

	const rawUserId = source.userId as unknown;
	const ownerUserId =
		rawUserId && typeof rawUserId === "object" && "_id" in rawUserId
			? String((rawUserId as { _id: unknown })._id)
			: String(rawUserId);

	const targetUserId = opts.targetUserId ?? ownerUserId;

	const doc = await UserNutritionPlan.create({
		userId: toObjectId(targetUserId, "BAD_REQUEST", "Invalid user ID"),
		nutritionistId: toObjectId(actor.id, "BAD_REQUEST", "Invalid nutritionist ID"),
		sourceTemplateId: source.sourceTemplateId ?? null,
		name: opts.name ?? `${source.name} (Copy)`,
		goal: source.goal,
		status: NutritionPlanStatus.Draft,
		startDate: source.startDate,
		endDate: source.endDate ?? null,
		targetCaloriesKcal: source.targetCaloriesKcal ?? null,
		targetMacros: source.targetMacros ?? {},
		durationDays: source.durationDays,
		days: cloneDays(source.days),
		lifestyleRecommendations: JSON.parse(
			JSON.stringify(source.lifestyleRecommendations ?? []),
		),
	});

	return UserNutritionPlan.findById(doc._id)
		.populate(MEMBER_POPULATE)
		.lean();
};
