import type { RequestHandler } from "express";
import type { NutritionGoal, NutritionPlanStatus } from "../models/Enums";
import UserNutritionPlan from "../models/nutrition-plan.model";
import NutritionTemplate from "../models/nutrition-template.model";
import {
	assignTemplateToUser,
	createAdHocPlan,
	deletePlan,
	duplicatePlan,
	getPlan,
	listNutritionistPlans,
	listUserPlans,
	setPlanStatus,
	updatePlan,
} from "../services/nutrition/nutrition-assignment.service";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	generatePlanPdf,
	getPlanPdf,
} from "../services/nutrition/nutrition-plan-pdf.service";
import type { DayInput } from "../types/nutrition";
import {
	assignTemplateBodySchema,
	copyDayStructureSchema,
	createAdHocPlanBodySchema,
	duplicatePlanBodySchema,
	planListQuerySchema,
	planStatusBodySchema,
	updatePlanBodySchema,
} from "../validators/nutrition-plan.validator";

// biome-ignore lint/suspicious/noExplicitAny: populated Mongoose docs lose strict typing
const withMember = (plan: any) => {
	if (!plan) return plan;
	const obj =
		typeof plan.toObject === "function" ? plan.toObject() : { ...plan };
	const populated = obj.userId;
	if (populated && typeof populated === "object" && populated._id) {
		obj.member = {
			_id: populated._id,
			username: populated.username,
			email: populated.email,
			phone: populated.phone,
		};
		obj.userId = populated._id;
	}
	return obj;
};

export const assignTemplate: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = assignTemplateBodySchema.safeParse(req.body);
	if (!parsed.success) {
		if (process.env.NODE_ENV !== "production") {
			console.warn("[assignTemplate] validation failed", {
				path: req.originalUrl,
				body: req.body,
				issues: parsed.error.issues,
			});
		}
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const templateId = requireIdParam(req.params.id, "Template not found");
		const { plan, warnings } = await assignTemplateToUser(
			templateId,
			parsed.data.userId,
			requester,
			{
				startDate: parsed.data.startDate,
				endDate: parsed.data.endDate ?? null,
			},
		);
		res.status(201).json({
			message: "Template assigned",
			plan: withMember(plan),
			warnings,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const createPlan: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = createAdHocPlanBodySchema.safeParse(req.body);
	if (!parsed.success) {
		if (process.env.NODE_ENV !== "production") {
			console.warn("[createPlan] validation failed", {
				path: req.originalUrl,
				body: req.body,
				issues: parsed.error.issues,
			});
		}
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const { userId, goal, days, ...rest } = parsed.data;
		const { plan, warnings } = await createAdHocPlan(
			{
				...rest,
				goal: goal as NutritionGoal,
				days: days as DayInput[],
			},
			userId,
			requester.id,
		);
		res.status(201).json({
			message: "Plan created",
			plan: withMember(plan),
			warnings,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listManagedPlans: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = planListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const plans = await listNutritionistPlans(requester.id, {
			status: parsed.data.status as NutritionPlanStatus | undefined,
			userId: parsed.data.userId,
		});
		res.status(200).json({ plans: plans.map(withMember) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanById: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await getPlan(planId, requester);
		res.status(200).json({ plan: withMember(plan) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const patchPlan: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = updatePlanBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const { goal, days, ...rest } = parsed.data;
		const plan = await updatePlan(
			planId,
			{
				...rest,
				goal: goal as NutritionGoal | undefined,
				days: days as DayInput[] | undefined,
			},
			requester,
		);
		res.status(200).json({ message: "Plan updated", plan: withMember(plan) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const changePlanStatus: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = planStatusBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await setPlanStatus(
			planId,
			parsed.data.status as NutritionPlanStatus,
			requester,
		);
		res
			.status(200)
			.json({ message: "Plan status updated", plan: withMember(plan) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listMyPlans: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = planListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const plans = await listUserPlans(requester.id, {
			status: parsed.data.status as NutritionPlanStatus | undefined,
		});
		res.status(200).json({ plans: plans.map(withMember) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getMyPlanById: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await getPlan(planId, requester);
		res.status(200).json({ plan: withMember(plan) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const generatePlanPdfHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const result = await generatePlanPdf(planId, requester);
		res.status(200).json({ message: "Plan PDF generated", ...result });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanPdfHandler: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const result = await getPlanPdf(planId, requester);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const duplicatePlanHandler: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = duplicatePlanBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await duplicatePlan(planId, requester, parsed.data);
		res
			.status(201)
			.json({ message: "Plan duplicated", plan: withMember(plan) });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const deletePlanPage: RequestHandler = async (req, res, next) => {
	// kept for compatibility
};

export const deletePlanHandler: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		await deletePlan(planId, requester);
		res.status(200).json({ message: "Plan removed" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const copyPlanDayStructure: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = copyDayStructureSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const { planId, sourceDayOfWeek, targetDaysOfWeek, strategy } = parsed.data;

		let document: any = await UserNutritionPlan.findById(planId);
		let isTemplate = false;
		if (!document) {
			document = await NutritionTemplate.findById(planId);
			isTemplate = true;
		}

		if (!document) {
			res
				.status(404)
				.json({ error: "Plan or template not found", code: "NOT_FOUND" });
			return;
		}

		const dayOfWeekToNumber = (day: string): number => {
			const mapping: { [key: string]: number } = {
				Sunday: 7,
				Monday: 1,
				Tuesday: 2,
				Wednesday: 3,
				Thursday: 4,
				Friday: 5,
				Saturday: 6,
			};
			return mapping[day] ?? 1;
		};

		const sourceDayNum = dayOfWeekToNumber(sourceDayOfWeek);
		const sourceDayDoc = document.days.find(
			(d: any) => d.dayNumber === sourceDayNum,
		);
		if (!sourceDayDoc) {
			res.status(400).json({
				error: `Source day (${sourceDayOfWeek}) not configured in the template/plan.`,
				code: "BAD_REQUEST",
			});
			return;
		}

		const stripIds = (obj: any): any => {
			if (Array.isArray(obj)) {
				return obj.map(stripIds);
			} else if (obj !== null && typeof obj === "object") {
				const plainObj =
					typeof obj.toObject === "function" ? obj.toObject() : { ...obj };
				delete plainObj._id;
				delete plainObj.id;
				for (const key in plainObj) {
					plainObj[key] = stripIds(plainObj[key]);
				}
				return plainObj;
			}
			return obj;
		};

		const sourceMealsPlain = stripIds(sourceDayDoc.meals);
		let targetDayNums: number[] = targetDaysOfWeek.map(dayOfWeekToNumber);

		if (strategy === "split_week") {
			const isWeekdaySelected = targetDaysOfWeek.some((d) =>
				["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].includes(d),
			);
			if (isWeekdaySelected) {
				targetDayNums = [1, 2, 3, 4, 5];
			} else {
				targetDayNums = [6, 7];
			}
		}

		for (const targetDayNum of targetDayNums) {
			if (targetDayNum === sourceDayNum) continue;

			let mealsToCopy = JSON.parse(JSON.stringify(sourceMealsPlain));
			if (strategy === "alternate") {
				const altDayNum = sourceDayNum === 1 ? 2 : 1;
				const altDayDoc = document.days.find(
					(d: any) => d.dayNumber === altDayNum,
				);
				if (altDayDoc && targetDayNum % 2 !== sourceDayNum % 2) {
					mealsToCopy = stripIds(altDayDoc.meals);
				}
			}

			const targetDayDoc = document.days.find(
				(d: any) => d.dayNumber === targetDayNum,
			);
			if (!targetDayDoc) {
				document.days.push({
					dayNumber: targetDayNum,
					meals: mealsToCopy,
				});
			} else {
				targetDayDoc.meals = mealsToCopy;
			}
		}

		document.days.sort((a: any, b: any) => a.dayNumber - b.dayNumber);
		await document.save();

		res.status(200).json({
			message: `Day structure replicated to target days successfully.`,
			days: document.days,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
