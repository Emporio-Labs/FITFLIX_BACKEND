import type { NutritionGoal, NutritionPlanStatus } from "../../models/Enums";
import NutritionTemplate from "../../models/nutrition-template.model";
import UserNutritionPlan, {
	type UserNutritionPlanDocument,
} from "../../models/nutrition-plan.model";
import type { DayInput, NutritionActor } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import { resolveDaysToSnapshots } from "./nutrition-snapshot.util";

export type AssignOptions = {
	startDate: Date;
	endDate?: Date | null;
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

	return UserNutritionPlan.create({
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
		days: cloneDays(template.days),
	});
};

export const createAdHocPlan = async (
	input: AdHocPlanInput,
	userId: string,
	nutritionistId: string,
) => {
	const days = input.days ? await resolveDaysToSnapshots(input.days) : [];

	return UserNutritionPlan.create({
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
	});
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
	return UserNutritionPlan.find(filter).sort({ startDate: -1 });
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
	return UserNutritionPlan.find(filter).sort({ updatedAt: -1 });
};

// Authorization: the owning user, the assigning nutritionist, or any admin.
export const getPlan = async (planId: string, actor: NutritionActor) => {
	const id = toObjectId(planId, "NOT_FOUND", "Plan not found");
	const plan = await UserNutritionPlan.findById(id);

	if (!plan) {
		throw new NutritionServiceError("NOT_FOUND", "Plan not found");
	}

	const isOwnerUser =
		actor.role === "user" && plan.userId.toString() === actor.id;
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
	return plan;
};
