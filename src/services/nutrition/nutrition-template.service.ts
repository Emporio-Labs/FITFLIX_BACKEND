import type { NutritionGoal, NutritionPlanStatus } from "../../models/Enums";
import NutritionTemplate from "../../models/nutrition-template.model";
import type { DayInput, NutritionActor } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";
import { resolveDaysToSnapshots } from "./nutrition-snapshot.util";

export type LifestyleRecommendationInput = {
	title: string;
	description?: string;
	category?: string;
};

export type TemplateInput = {
	name: string;
	description?: string;
	goal: NutritionGoal;
	status?: NutritionPlanStatus;
	tags?: string[];
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

export type TemplateListFilters = {
	status?: NutritionPlanStatus;
	goal?: NutritionGoal;
	tag?: string;
};

export const createTemplate = async (
	input: TemplateInput,
	nutritionistId: string,
) => {
	const ownerId = toObjectId(
		nutritionistId,
		"BAD_REQUEST",
		"Invalid nutritionist ID",
	);

	const days = input.days ? await resolveDaysToSnapshots(input.days) : [];

	return NutritionTemplate.create({
		name: input.name,
		description: input.description ?? "",
		createdBy: ownerId,
		goal: input.goal,
		status: input.status,
		tags: input.tags ?? [],
		targetCaloriesKcal: input.targetCaloriesKcal ?? null,
		targetMacros: input.targetMacros ?? {},
		durationDays: input.durationDays ?? 7,
		days,
		lifestyleRecommendations: input.lifestyleRecommendations ?? [],
	});
};

export const listTemplates = async (
	nutritionistId: string,
	filters: TemplateListFilters,
) => {
	const ownerId = toObjectId(
		nutritionistId,
		"BAD_REQUEST",
		"Invalid nutritionist ID",
	);

	const filter: Record<string, unknown> = { createdBy: ownerId };
	if (filters.status) {
		filter.status = filters.status;
	}
	if (filters.goal) {
		filter.goal = filters.goal;
	}
	if (filters.tag) {
		filter.tags = filters.tag;
	}

	return NutritionTemplate.find(filter).sort({ updatedAt: -1 });
};

const loadOwnedTemplate = async (
	templateId: string,
	actor: NutritionActor,
) => {
	const id = toObjectId(templateId, "NOT_FOUND", "Template not found");
	const template = await NutritionTemplate.findById(id);

	if (!template) {
		throw new NutritionServiceError("NOT_FOUND", "Template not found");
	}

	if (
		actor.role !== "admin" &&
		template.createdBy.toString() !== actor.id
	) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"You do not own this template",
		);
	}

	return template;
};

export const getTemplate = async (
	templateId: string,
	actor: NutritionActor,
) => loadOwnedTemplate(templateId, actor);

export const updateTemplate = async (
	templateId: string,
	patch: Partial<TemplateInput>,
	actor: NutritionActor,
) => {
	const template = await loadOwnedTemplate(templateId, actor);

	const { days, ...rest } = patch;
	template.set(rest);

	if (days) {
		template.set({ days: await resolveDaysToSnapshots(days) });
	}

	await template.save();
	return template;
};

export const deleteTemplate = async (
	templateId: string,
	actor: NutritionActor,
) => {
	const template = await loadOwnedTemplate(templateId, actor);
	await template.deleteOne();
};
