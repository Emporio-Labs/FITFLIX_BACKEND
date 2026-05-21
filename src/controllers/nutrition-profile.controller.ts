import type { RequestHandler } from "express";
import type { DietaryPreference, NutritionGoal } from "../models/Enums";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	createProfile,
	deleteProfile,
	getMyProfile,
	getProfileByUser,
	updateProfile,
} from "../services/nutrition/nutrition-profile.service";
import {
	createProfileBodySchema,
	updateProfileBodySchema,
} from "../validators/nutrition-profile.validator";

export const createProfileHandler: RequestHandler = async (req, res, next) => {
	const parsed = createProfileBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const profile = await createProfile(
			{
				...parsed.data,
				goal: parsed.data.goal as NutritionGoal,
				dietaryPreference: parsed.data.dietaryPreference as
					| DietaryPreference
					| undefined,
			},
			req.user!.id,
		);
		res.status(201).json({ message: "Nutrition profile created", profile });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const updateProfileHandler: RequestHandler = async (req, res, next) => {
	const parsed = updateProfileBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const userId = requireIdParam(req.params.userId, "User not found");
		const { goal, dietaryPreference, ...restPatch } = parsed.data;
		const profile = await updateProfile(
			userId,
			{
				...restPatch,
				...(goal !== undefined ? { goal: goal as NutritionGoal } : {}),
				...(dietaryPreference !== undefined
					? { dietaryPreference: dietaryPreference as DietaryPreference }
					: {}),
			},
			req.user!,
		);
		res.status(200).json({ message: "Nutrition profile updated", profile });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getProfileByUserHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const userId = requireIdParam(req.params.userId, "User not found");
		const profile = await getProfileByUser(userId, req.user!);
		res.status(200).json({ profile });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getMyProfileHandler: RequestHandler = async (req, res, next) => {
	try {
		const profile = await getMyProfile(req.user!);
		res.status(200).json({ profile });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const deleteProfileHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = requireIdParam(req.params.userId, "User not found");
		await deleteProfile(userId, req.user!);
		res.status(200).json({ message: "Nutrition profile deleted" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
