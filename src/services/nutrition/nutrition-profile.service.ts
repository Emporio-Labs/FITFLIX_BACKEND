import mongoose from "mongoose";
import type { DietaryPreference, NutritionGoal } from "../../models/Enums";
import NutritionProfile from "../../models/nutrition-profile.model";
import type { NutritionActor } from "../../types/nutrition";
import { NutritionServiceError, toObjectId } from "./nutrition-errors";

export type CreateProfileInput = {
	userId: string;
	goal: NutritionGoal;
	dietaryPreference?: DietaryPreference;
	allergies?: string[];
	medicalConditions?: string[];
	preferredFoods?: string[];
	dislikedFoods?: string[];
	targetCaloriesKcal?: number | null;
	targetMacros?: {
		proteinG?: number | null;
		carbsG?: number | null;
		fatG?: number | null;
		fiberG?: number | null;
		sugarG?: number | null;
	};
	mealsPerDay?: number;
	waterTargetLiters?: number | null;
	notes?: string;
};

export type UpdateProfileInput = Partial<Omit<CreateProfileInput, "userId">>;

// Reads allergies, medicalConditions, preferredFoods from onboarding models
// without ever mutating them. Used to pre-populate the profile on creation.
const prefillFromOnboarding = async (userId: string) => {
	try {
		const [{ default: HealthMarkers }, { default: HealthGoals }] =
			await Promise.all([
				import("../../models/HealthMarkers"),
				import("../../models/HealthGoals"),
			]);

		const [markers, goals] = await Promise.all([
			HealthMarkers.findOne({ userId: new mongoose.Types.ObjectId(userId) }),
			HealthGoals.findOne({ userId: new mongoose.Types.ObjectId(userId) }),
		]);

		return {
			allergies: (markers?.allergies as string[] | undefined) ?? [],
			medicalConditions:
				((markers?.diseaseHistory as string[] | undefined) ?? []).concat(
					(markers?.medications as string[] | undefined) ?? [],
				),
			preferredFoods: (goals?.foodPreferences as string[] | undefined) ?? [],
		};
	} catch {
		return { allergies: [], medicalConditions: [], preferredFoods: [] };
	}
};

const litersToMl = (liters: number | null | undefined): number | null => {
	if (liters === null || liters === undefined) return null;
	return Math.round(liters * 1000);
};

// Shape the profile for API responses:
//   - derive waterTargetLiters from the persisted waterTargetMl
//   - expose createdByNutritionist as assignedNutritionistId (frontend-facing
//     name; the persisted field stays unchanged)
const toProfileDto = (
	profile:
		| ({
				waterTargetMl?: number | null;
				createdByNutritionist?: unknown;
		  } & Record<string, unknown>)
		| null,
) => {
	if (!profile) return profile;
	return {
		...profile,
		waterTargetLiters:
			profile.waterTargetMl !== null && profile.waterTargetMl !== undefined
				? (profile.waterTargetMl as number) / 1000
				: null,
		assignedNutritionistId: profile.createdByNutritionist ?? null,
	};
};

const addWaterLiters = toProfileDto;

export const createProfile = async (
	input: CreateProfileInput,
	nutritionistId: string,
) => {
	const userObjectId = toObjectId(input.userId, "BAD_REQUEST", "Invalid user ID");

	const existing = await NutritionProfile.findOne({ userId: userObjectId });
	if (existing) {
		throw new NutritionServiceError(
			"CONFLICT",
			"A nutrition profile already exists for this user",
		);
	}

	const prefill = await prefillFromOnboarding(input.userId);

	const doc = await NutritionProfile.create({
		userId: userObjectId,
		goal: input.goal,
		dietaryPreference: input.dietaryPreference,
		allergies: input.allergies ?? prefill.allergies,
		medicalConditions: input.medicalConditions ?? prefill.medicalConditions,
		preferredFoods: input.preferredFoods ?? prefill.preferredFoods,
		dislikedFoods: input.dislikedFoods ?? [],
		targetCaloriesKcal: input.targetCaloriesKcal ?? null,
		targetMacros: input.targetMacros ?? {},
		mealsPerDay: input.mealsPerDay ?? 3,
		waterTargetMl: litersToMl(input.waterTargetLiters),
		notes: input.notes ?? "",
		createdByNutritionist: toObjectId(
			nutritionistId,
			"BAD_REQUEST",
			"Invalid nutritionist ID",
		),
	});

	return addWaterLiters(doc.toObject());
};

export const updateProfile = async (
	userId: string,
	patch: UpdateProfileInput,
	actor: NutritionActor,
) => {
	if (actor.role === "user") {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"Users cannot update nutrition profiles",
		);
	}

	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const profile = await NutritionProfile.findOne({ userId: userObjectId });
	if (!profile) {
		throw new NutritionServiceError("NOT_FOUND", "Nutrition profile not found");
	}

	const { waterTargetLiters, ...rest } = patch;
	profile.set(rest);
	if (waterTargetLiters !== undefined) {
		profile.set({ waterTargetMl: litersToMl(waterTargetLiters) });
	}

	await profile.save();
	return addWaterLiters(profile.toObject());
};

export const getProfileByUser = async (
	userId: string,
	actor: NutritionActor,
) => {
	if (actor.role === "user" && actor.id !== userId) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"You can only view your own nutrition profile",
		);
	}

	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const profile = await NutritionProfile.findOne({ userId: userObjectId });
	if (!profile) {
		throw new NutritionServiceError("NOT_FOUND", "Nutrition profile not found");
	}
	return addWaterLiters(profile.toObject());
};

export const getMyProfile = async (actor: NutritionActor) => {
	const userObjectId = toObjectId(actor.id, "BAD_REQUEST", "Invalid user ID");
	const profile = await NutritionProfile.findOne({ userId: userObjectId });
	if (!profile) {
		throw new NutritionServiceError("NOT_FOUND", "Nutrition profile not found");
	}
	return addWaterLiters(profile.toObject());
};

export const deleteProfile = async (
	userId: string,
	actor: NutritionActor,
) => {
	if (actor.role === "user") {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"Users cannot delete nutrition profiles",
		);
	}

	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const result = await NutritionProfile.deleteOne({ userId: userObjectId });
	if (result.deletedCount === 0) {
		throw new NutritionServiceError("NOT_FOUND", "Nutrition profile not found");
	}
};
