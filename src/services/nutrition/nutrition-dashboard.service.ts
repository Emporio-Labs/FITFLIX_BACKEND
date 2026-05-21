import mongoose from "mongoose";
import {
	AppointmentBookingStatus,
	ExpertType,
	MealLogStatus,
	MealType,
	NutritionGoal,
	NutritionPlanStatus,
} from "../../models/Enums";
import ExpertAppointment from "../../models/ExpertAppointment";
import HealthGoals from "../../models/HealthGoals";
import HealthMarkers from "../../models/HealthMarkers";
import NutritionProfile from "../../models/nutrition-profile.model";
import NutritionHydrationLog from "../../models/nutrition-hydration.model";
import UserNutritionPlan from "../../models/nutrition-plan.model";
import NutritionMealLog from "../../models/nutrition-meal-log.model";
import User from "../../models/User";
import { getEffectiveMealItems, sumMacros } from "./nutrition-macro.util";

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export const getDashboardStats = async () => {
	const [pendingBookings, confirmedBookings, distinctMembers, activePlans] =
		await Promise.all([
			ExpertAppointment.countDocuments({
				expertType: ExpertType.Nutritionist,
				bookingStatus: AppointmentBookingStatus.Pending,
			}),
			ExpertAppointment.countDocuments({
				expertType: ExpertType.Nutritionist,
				bookingStatus: AppointmentBookingStatus.Confirmed,
			}),
			UserNutritionPlan.distinct("userId"),
			UserNutritionPlan.countDocuments({
				status: NutritionPlanStatus.Active,
			}),
		]);

	return {
		pendingBookings,
		confirmedBookings,
		totalMembers: distinctMembers.length,
		activePlans,
	};
};

// ---------------------------------------------------------------------------
// Dashboard member roster  (powers Bookings tab + /nutrition/members alias)
// ---------------------------------------------------------------------------

const escapeRegex = (s: string) =>
	s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getDashboardMembers = async (options: {
	search?: string;
	status?: "pending" | "booked" | "assigned" | "completed";
	page: number;
	limit: number;
}) => {
	const { search, status, page, limit } = options;

	const pipeline: mongoose.PipelineStage[] = [
		{
			$lookup: {
				from: "usernutritionplans",
				localField: "_id",
				foreignField: "userId",
				as: "nutritionPlans",
			},
		},
		{
			$lookup: {
				from: "expertappointments",
				let: { uid: "$_id" },
				pipeline: [
					{
						$match: {
							$expr: { $eq: ["$userId", "$$uid"] },
							expertType: ExpertType.Nutritionist,
						},
					},
				],
				as: "nutritionistAppointments",
			},
		},
		{
			$match: {
				$or: [
					{ "nutritionPlans.0": { $exists: true } },
					{ "nutritionistAppointments.0": { $exists: true } },
				],
			},
		},
		{
			$addFields: {
				assignedPlans: { $size: "$nutritionPlans" },
				activePlanCount: {
					$size: {
						$filter: {
							input: "$nutritionPlans",
							cond: {
								$eq: [
									"$$this.status",
									NutritionPlanStatus.Active,
								],
							},
						},
					},
				},
				completedPlanCount: {
					$size: {
						$filter: {
							input: "$nutritionPlans",
							cond: {
								$eq: [
									"$$this.status",
									NutritionPlanStatus.Completed,
								],
							},
						},
					},
				},
				appointmentStatus: {
					$ifNull: [
						{
							$arrayElemAt: [
								"$nutritionistAppointments.bookingStatus",
								0,
							],
						},
						null,
					],
				},
			},
		},
		{
			$addFields: {
				nutritionStatus: {
					$switch: {
						branches: [
							{
								case: { $gt: ["$activePlanCount", 0] },
								then: "assigned",
							},
							{
								case: { $gt: ["$completedPlanCount", 0] },
								then: "completed",
							},
							{
								case: {
									$eq: [
										"$appointmentStatus",
										AppointmentBookingStatus.Confirmed,
									],
								},
								then: "booked",
							},
							{
								case: {
									$eq: [
										"$appointmentStatus",
										AppointmentBookingStatus.Pending,
									],
								},
								then: "pending",
							},
						],
						default: "pending",
					},
				},
				nutritionBookingStatus: "$appointmentStatus",
				activeNutritionPlan: {
					$let: {
						vars: {
							active: {
								$arrayElemAt: [
									{
										$filter: {
											input: "$nutritionPlans",
											cond: {
												$eq: [
													"$$this.status",
													NutritionPlanStatus.Active,
												],
											},
										},
									},
									0,
								],
							},
						},
						in: {
							$cond: [
								{ $ifNull: ["$$active", false] },
								{
									_id: "$$active._id",
									name: "$$active.name",
									status: "$$active.status",
									startDate: "$$active.startDate",
									endDate: "$$active.endDate",
								},
								null,
							],
						},
					},
				},
			},
		},
		{
			$lookup: {
				from: "nutritionprofiles",
				localField: "_id",
				foreignField: "userId",
				as: "nutritionProfileDocs",
			},
		},
		{
			$addFields: {
				nutritionProfileDoc: {
					$arrayElemAt: ["$nutritionProfileDocs", 0],
				},
			},
		},
		{
			$lookup: {
				from: "users",
				localField: "nutritionProfileDoc.createdByNutritionist",
				foreignField: "_id",
				as: "assignedNutritionistDocs",
			},
		},
		{
			$addFields: {
				assignedNutritionist: {
					$let: {
						vars: {
							n: { $arrayElemAt: ["$assignedNutritionistDocs", 0] },
						},
						in: {
							$cond: [
								{ $ifNull: ["$$n", false] },
								{
									_id: "$$n._id",
									username: "$$n.username",
									email: "$$n.email",
								},
								null,
							],
						},
					},
				},
				nutritionProfile: {
					$cond: [
						{ $ifNull: ["$nutritionProfileDoc", false] },
						{
							_id: "$nutritionProfileDoc._id",
							goal: "$nutritionProfileDoc.goal",
							dietaryPreference:
								"$nutritionProfileDoc.dietaryPreference",
							allergies: "$nutritionProfileDoc.allergies",
							targetCaloriesKcal:
								"$nutritionProfileDoc.targetCaloriesKcal",
							targetMacros: "$nutritionProfileDoc.targetMacros",
							assignedNutritionistId:
								"$nutritionProfileDoc.createdByNutritionist",
						},
						null,
					],
				},
			},
		},
		// ── HealthMarkers lookup (lightweight, projected to needed fields only) ──
		{
			$lookup: {
				from: "healthmarkers",
				let: { uid: "$_id" },
				pipeline: [
					{ $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
					{
						$project: {
							_id: 0,
							weight: 1,
							height: 1,
							gender: 1,
							activityLevel: 1,
						},
					},
				],
				as: "_healthMarkersDocs",
			},
		},
		// ── HealthGoals lookup (goals[] only) ──────────────────────────────────
		{
			$lookup: {
				from: "healthgoals",
				let: { uid: "$_id" },
				pipeline: [
					{ $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
					{ $project: { _id: 0, goals: 1 } },
				],
				as: "_healthGoalsDocs",
			},
		},
	];

	if (status) {
		pipeline.push({ $match: { nutritionStatus: status } });
	}

	if (search) {
		const regex = new RegExp(escapeRegex(search), "i");
		pipeline.push({
			$match: {
				$or: [
					{ username: { $regex: regex } },
					{ email: { $regex: regex } },
					{ phone: { $regex: regex } },
				],
			},
		});
	}

	pipeline.push(
		{
			$project: {
				_id: 1,
				username: 1,
				name: "$username",
				email: 1,
				phone: 1,
				age: 1,
				gender: 1,
				onboardingStep: "$onboardingStatus.currentStep",
				nutritionBookingStatus: 1,
				nutritionStatus: 1,
				nutritionProfile: 1,
				activeNutritionPlan: 1,
				assignedNutritionist: 1,
				assignedPlans: 1,
				// Health marker fields required by My Nutrition profile cards
				healthMarkers: {
					$cond: [
						{ $gt: [{ $size: "$_healthMarkersDocs" }, 0] },
						{ $arrayElemAt: ["$_healthMarkersDocs", 0] },
						{},
					],
				},
				healthGoals: {
					$cond: [
						{ $gt: [{ $size: "$_healthGoalsDocs" }, 0] },
						{ $arrayElemAt: ["$_healthGoalsDocs.goals", 0] },
						{ $ifNull: ["$healthGoals", []] },
					],
				},
			},
		},
		{
			$facet: {
				items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
				totalCount: [{ $count: "count" }],
			},
		},
	);

	const [result] = await User.aggregate(pipeline);

	const items = result?.items ?? [];
	const total = result?.totalCount?.[0]?.count ?? 0;

	return {
		items,
		pagination: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

// ---------------------------------------------------------------------------
// Goal inference — maps free-text onboarding goals → NutritionGoal enum
// ---------------------------------------------------------------------------

const GOAL_KEYWORDS: Array<{ keywords: string[]; goal: NutritionGoal }> = [
	{
		keywords: [
			"weight loss",
			"fat loss",
			"lose weight",
			"lose fat",
			"cut",
			"cutting",
			"slim",
			"lean",
			"reduce weight",
		],
		goal: NutritionGoal.WeightLoss,
	},
	{
		keywords: [
			"muscle gain",
			"build muscle",
			"muscle building",
			"bulk",
			"bulking",
			"mass",
			"hypertrophy",
			"strength",
			"gain weight",
		],
		goal: NutritionGoal.MuscleGain,
	},
	{
		keywords: [
			"endurance",
			"stamina",
			"athletic",
			"performance",
			"marathon",
			"cardio",
			"running",
			"cycling",
		],
		goal: NutritionGoal.Endurance,
	},
	{
		keywords: [
			"maintain",
			"maintenance",
			"stay healthy",
			"healthy lifestyle",
			"general health",
		],
		goal: NutritionGoal.Maintenance,
	},
];

export const inferNutritionGoal = (
	rawGoals: string[] | string | undefined | null,
): NutritionGoal => {
	if (!rawGoals) return NutritionGoal.Maintenance;

	const goalsArr = Array.isArray(rawGoals) ? rawGoals : [rawGoals];
	const combined = goalsArr.join(" ").toLowerCase().trim();

	if (!combined) return NutritionGoal.Maintenance;

	// Check if it's already a valid enum value
	const enumValues = Object.values(NutritionGoal) as string[];
	for (const g of goalsArr) {
		if (enumValues.includes(g.trim())) {
			return g.trim() as NutritionGoal;
		}
	}

	// Map free-text → enum
	for (const { keywords, goal } of GOAL_KEYWORDS) {
		if (keywords.some((kw) => combined.includes(kw))) {
			return goal;
		}
	}

	return NutritionGoal.Custom;
};

// ---------------------------------------------------------------------------
// Activity multipliers + goal calorie adjustments
// ---------------------------------------------------------------------------

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
	Sedentary: 1.2,
	Light: 1.375,
	Moderate: 1.55,
	Active: 1.725,
	VeryActive: 1.9,
};

const GOAL_CALORIE_ADJUSTMENTS: Record<string, number> = {
	[NutritionGoal.WeightLoss]: -500,
	[NutritionGoal.MuscleGain]: 300,
	[NutritionGoal.Endurance]: 200,
	[NutritionGoal.Maintenance]: 0,
	[NutritionGoal.Medical]: 0,
	[NutritionGoal.Custom]: 0,
};

const GOAL_PROTEIN_MULTIPLIERS: Record<string, number> = {
	[NutritionGoal.WeightLoss]: 1.4,
	[NutritionGoal.MuscleGain]: 2.0,
	[NutritionGoal.Endurance]: 1.6,
	[NutritionGoal.Maintenance]: 1.2,
	[NutritionGoal.Medical]: 1.2,
	[NutritionGoal.Custom]: 1.2,
};

// Target source type — mirrors what the frontend uses for banners
export type TargetSource = "plan" | "assessment" | "profile" | "weight_only" | "default" | "none";

interface MacroTargetResult {
	calories: number;
	protein: number;
	carbs: number;
	fat: number;
	water: number;
	source: TargetSource;
}

/**
 * 5-tier macro target resolution:
 * 1. Assigned plan macros  (plan.targetMacros + plan.targetCaloriesKcal)
 * 2. Nutrition assessment/profile macros  (NutritionProfile.targetMacros)
 * 3. Full Mifflin-St Jeor calculation  (weight + height + age + gender + activity)
 * 4. Weight-only calculation
 * 5. Default fallback  /  "none" when there is truly no data
 */
const resolveNutritionTargets = (
	plan: any,
	nutritionProfile: any,
	healthMarkers: any,
	user: any,
	goal: NutritionGoal,
): MacroTargetResult => {
	// ── Tier 1: Plan macros ──────────────────────────────────────────────────
	if (plan?.targetMacros) {
		const { proteinG, carbsG, fatG } = plan.targetMacros;
		const targetCalories = plan.targetCaloriesKcal;
		if (
			proteinG != null &&
			carbsG != null &&
			fatG != null &&
			targetCalories != null
		) {
			const weight = healthMarkers?.weight ?? 70;
			return {
				calories: targetCalories,
				protein: proteinG,
				carbs: carbsG,
				fat: fatG,
				water: Math.round(weight * 40),
				source: "plan",
			};
		}
	}

	// ── Tier 2: Nutrition assessment / profile macros ────────────────────────
	if (nutritionProfile) {
		const { proteinG, carbsG, fatG } = nutritionProfile.targetMacros ?? {};
		const targetCalories = nutritionProfile.targetCaloriesKcal;
		if (
			proteinG != null &&
			carbsG != null &&
			fatG != null &&
			targetCalories != null
		) {
			const weight = healthMarkers?.weight ?? 70;
			const waterTarget = nutritionProfile.waterTargetMl ?? Math.round(weight * 40);
			return {
				calories: targetCalories,
				protein: proteinG,
				carbs: carbsG,
				fat: fatG,
				water: waterTarget,
				source: "assessment",
			};
		}
	}

	// ── Tier 3: Full Mifflin-St Jeor ────────────────────────────────────────
	const weight = healthMarkers?.weight;
	const height = healthMarkers?.height;
	// age from User document (stored on User.age), fallback to undefined
	const age: number | undefined =
		typeof user?.age === "number" && user.age > 0 ? user.age : undefined;
	// gender: User.gender is a string enum "Male"/"Female"/"Others"
	const gender: string | undefined =
		typeof user?.gender === "string" ? user.gender : undefined;

	if (weight && height && age !== undefined && gender !== undefined) {
		// Mifflin-St Jeor BMR
		// Male:   10×weight + 6.25×height − 5×age + 5
		// Female: 10×weight + 6.25×height − 5×age − 161
		// Others: average of both
		let bmr: number;
		if (gender === "Male") {
			bmr = 10 * weight + 6.25 * height - 5 * age + 5;
		} else if (gender === "Female") {
			bmr = 10 * weight + 6.25 * height - 5 * age - 161;
		} else {
			// Others — use midpoint
			const maleBmr = 10 * weight + 6.25 * height - 5 * age + 5;
			const femaleBmr = 10 * weight + 6.25 * height - 5 * age - 161;
			bmr = (maleBmr + femaleBmr) / 2;
		}

		const activityMultiplier =
			ACTIVITY_MULTIPLIERS[healthMarkers?.activityLevel ?? "Moderate"] ?? 1.55;
		const tdee = Math.round(bmr * activityMultiplier);

		const calorieAdj = GOAL_CALORIE_ADJUSTMENTS[goal] ?? 0;
		const targetCalories = Math.max(1200, Math.round(tdee + calorieAdj));

		const proteinMultiplier = GOAL_PROTEIN_MULTIPLIERS[goal] ?? 1.2;
		const proteinG = Math.round(weight * proteinMultiplier);

		// ~30% of calories from fat, rest from carbs
		const proteinCal = proteinG * 4;
		const fatCal = Math.round(targetCalories * 0.3);
		const fatG = Math.round(fatCal / 9);
		const carbCal = Math.max(0, targetCalories - proteinCal - fatCal);
		const carbsG = Math.round(carbCal / 4);

		const waterMl = Math.round(weight * 40);

		return {
			calories: targetCalories,
			protein: proteinG,
			carbs: carbsG,
			fat: fatG,
			water: waterMl,
			source: "profile",
		};
	}

	// ── Tier 4: Weight-only calculation ─────────────────────────────────────
	if (weight) {
		// Conservative estimate: 30–35 kcal/kg depending on goal
		const kcalPerKg =
			goal === NutritionGoal.WeightLoss
				? 26
				: goal === NutritionGoal.MuscleGain
					? 36
					: 30;

		const targetCalories = Math.round(weight * kcalPerKg);
		const proteinMultiplier = GOAL_PROTEIN_MULTIPLIERS[goal] ?? 1.2;
		const proteinG = Math.round(weight * proteinMultiplier);
		const fatFactor = 0.9; // ~0.9g fat/kg
		const fatG = Math.round(weight * fatFactor);
		const carbCal = Math.max(0, targetCalories - proteinG * 4 - fatG * 9);
		const carbsG = Math.round(carbCal / 4);
		const waterMl = Math.round(weight * 40);

		return {
			calories: targetCalories,
			protein: proteinG,
			carbs: carbsG,
			fat: fatG,
			water: waterMl,
			source: "weight_only",
		};
	}

	// ── Tier 5: Default fallback ─────────────────────────────────────────────
	// If there is truly no profile data at all, signal "none" so the frontend
	// can show the "No nutrition targets assigned" empty state.
	const hasAnyData =
		healthMarkers != null || nutritionProfile != null || plan != null;

	if (!hasAnyData) {
		return {
			calories: 0,
			protein: 0,
			carbs: 0,
			fat: 0,
			water: 0,
			source: "none",
		};
	}

	return {
		calories: 2000,
		protein: 80,
		carbs: 250,
		fat: 65,
		water: 3000,
		source: "default",
	};
};

// ---------------------------------------------------------------------------
// Scheduled meal times
// ---------------------------------------------------------------------------

const getMealScheduleTime = (
	mealType: string,
): { time: string; scheduledTime: string } => {
	const schedules: Record<string, string> = {
		[MealType.EarlyMorning]: "06:00",
		[MealType.Breakfast]: "08:00",
		[MealType.PreWorkout]: "11:00",
		[MealType.Lunch]: "13:00",
		[MealType.DuringWorkout]: "16:00",
		[MealType.PostWorkout]: "17:00",
		[MealType.Snack]: "15:00",
		[MealType.EveningSnack]: "18:00",
		[MealType.Dinner]: "20:00",
		[MealType.Bedtime]: "22:00",
	};

	const time = schedules[mealType] || "12:00";
	return { time, scheduledTime: time };
};

// ---------------------------------------------------------------------------
// Meal status engine
// ---------------------------------------------------------------------------

/**
 * Determine meal status:
 *  - completed  — all log items have status Logged
 *  - partial    — some but not all items logged
 *  - skipped    — no logs AND past scheduled time
 *  - pending    — no logs AND meal is in the future
 */
const determineMealStatus = (
	logs: any[],
	scheduledTime: string,
	today: Date,
): MealLogStatus => {
	const now = new Date();

	if (logs.length === 0) {
		const [hours = 0, minutes = 0] = scheduledTime.split(":").map(Number);
		const scheduledDate = new Date(today);
		scheduledDate.setHours(hours, minutes, 0, 0);

		if (now > scheduledDate) {
			return MealLogStatus.Skipped;
		}
		return MealLogStatus.Pending;
	}

	const allCompleted = logs.every(
		(log) => log.status === MealLogStatus.Logged,
	);
	if (allCompleted) return MealLogStatus.Logged;

	const someCompleted = logs.some(
		(log) => log.status === MealLogStatus.Logged,
	);
	if (someCompleted) return MealLogStatus.Partial;

	return MealLogStatus.Skipped;
};

// ---------------------------------------------------------------------------
// Intake summary helper — supports over-target (percentage > 100, exceededBy)
// ---------------------------------------------------------------------------

const buildIntakeEntry = (consumed: number, target: number) => {
	const safeTarget = target > 0 ? target : 1;
	const percentage = Math.round((consumed / safeTarget) * 100);
	const isOver = consumed > target;
	return {
		consumed,
		target,
		remaining: isOver ? 0 : Math.round(target - consumed),
		percentage,
		...(isOver ? { exceededBy: Math.round(consumed - target) } : {}),
	};
};

// ---------------------------------------------------------------------------
// Dashboard interface
// ---------------------------------------------------------------------------

export interface UserNutritionDashboard {
	user: {
		_id: string;
		username: string;
		email: string;
		phone: string;
		// Flat compat fields (legacy consumers)
		weight?: number;
		height?: number;
		goal?: string;
		activityLevel?: string;
		// New fields for My Nutrition profile header
		age: number | null;
		gender?: string;
		healthGoals: string[];
		healthMarkers: {
			weight?: number;
			height?: number;
			gender?: string;
			activityLevel?: string;
		};
	};
	assignedPlan?: {
		_id: string;
		name: string;
		goal: string;
		status: string;
		mealsPerDay: number;
		durationDays: number;
		startDate: Date;
		assignedByNutritionist?: string;
	};
	macroTargets: {
		calories: number;
		protein: number;
		carbs: number;
		fat: number;
		water: number;
	};
	targetSource: TargetSource;
	intakeSummary: {
		calories: {
			consumed: number;
			target: number;
			remaining: number;
			percentage: number;
			exceededBy?: number;
		};
		protein: {
			consumed: number;
			target: number;
			remaining: number;
			percentage: number;
			exceededBy?: number;
		};
		carbs: {
			consumed: number;
			target: number;
			remaining: number;
			percentage: number;
			exceededBy?: number;
		};
		fat: {
			consumed: number;
			target: number;
			remaining: number;
			percentage: number;
			exceededBy?: number;
		};
		water: {
			consumed: number;
			target: number;
			remaining: number;
			percentage: number;
			exceededBy?: number;
		};
	};
	todayMeals: Array<{
		mealType: string;
		scheduledTime: string;
		status: string;
		foods: Array<{
			name: string;
			qty: number;
			calories: number;
			protein: number;
			carbs: number;
			fat: number;
		}>;
		totals: {
			calories: number;
			protein: number;
			carbs: number;
			fat: number;
		};
	}>;
	skippedMeals: Array<{
		mealType: string;
		scheduledTime: string;
	}>;
	redistributionSummary: Array<{
		skippedMeal: string;
		redistributedTo: string[];
		proteinRecovered: number;
		caloriesRecovered: number;
	}>;
}

// ---------------------------------------------------------------------------
// Main user dashboard resolver
// ---------------------------------------------------------------------------

export const getUserNutritionDashboard = async (
	userId: string,
): Promise<UserNutritionDashboard> => {
	if (!mongoose.Types.ObjectId.isValid(userId)) {
		throw new Error("Invalid user ID");
	}

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const todayEnd = new Date();
	todayEnd.setHours(24, 0, 0, 0);

	// Parallel fetch — all data needed for dashboard
	const [
		user,
		healthMarkers,
		healthGoals,
		nutritionProfile,
		activePlan,
		todayMealLogs,
		todayHydration,
	] = await Promise.all([
		User.findById(userId)
			.select("_id username email phone age gender healthGoals")
			.lean(),
		HealthMarkers.findOne({ userId })
			.select("weight height bmi activityLevel")
			.lean(),
		HealthGoals.findOne({ userId })
			.select("goals")
			.lean(),
		NutritionProfile.findOne({ userId })
			.select(
				"goal targetCaloriesKcal targetMacros waterTargetMl createdByNutritionist",
			)
			.lean(),
		UserNutritionPlan.findOne({
			userId,
			status: NutritionPlanStatus.Active,
		})
			.select(
				"_id name goal status startDate durationDays targetCaloriesKcal targetMacros days nutritionistId",
			)
			.lean(),
		NutritionMealLog.find({
			userId,
			logDate: { $gte: todayStart, $lt: todayEnd },
		})
			.select("status items totals plannedMealRef dayNumber")
			.lean(),
		NutritionHydrationLog.findOne({
			userId,
			logDate: todayStart,
		})
			.select("totalMl goalMl")
			.lean(),
	]);

	if (!user) {
		throw new Error("User not found");
	}

	// ── Goal resolution ─────────────────────────────────────────────────────
	// Priority: active plan goal → nutrition profile goal → health goals → Maintenance
	let resolvedGoal: NutritionGoal;
	if (activePlan?.goal && Object.values(NutritionGoal).includes(activePlan.goal as NutritionGoal)) {
		resolvedGoal = activePlan.goal as NutritionGoal;
	} else if (nutritionProfile?.goal && Object.values(NutritionGoal).includes(nutritionProfile.goal as NutritionGoal)) {
		resolvedGoal = nutritionProfile.goal as NutritionGoal;
	} else {
		resolvedGoal = inferNutritionGoal(healthGoals?.goals ?? []);
	}

	// ── Macro targets (5-tier) ──────────────────────────────────────────────
	const targetResult = resolveNutritionTargets(
		activePlan,
		nutritionProfile,
		healthMarkers,
		user,
		resolvedGoal,
	);

	const macroTargets = {
		calories: targetResult.calories,
		protein: targetResult.protein,
		carbs: targetResult.carbs,
		fat: targetResult.fat,
		water: targetResult.water,
	};

	// ── Today's day number in the plan (1-indexed, cycled) ─────────────────
	const today = new Date(todayStart);
	let todayDayNumber = 1;
	if (activePlan?.startDate) {
		const planStart = new Date(activePlan.startDate);
		planStart.setHours(0, 0, 0, 0);
		const daysDiff = Math.floor(
			(today.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24),
		);
		const durationDays = activePlan.durationDays || 7;
		// Cycle within plan duration. Min 1.
		todayDayNumber = ((daysDiff % durationDays) + 1) || 1;
	}

	// Locate today's day in the plan — match on dayNumber only (1-indexed)
	const todayPlannedDay =
		activePlan?.days?.find((day: any) => day.dayNumber === todayDayNumber) ??
		activePlan?.days?.[0];

	const plannedMeals: any[] = todayPlannedDay?.meals ?? [];

	// ── Build today's meals ─────────────────────────────────────────────────
	const todayMeals: UserNutritionDashboard["todayMeals"] = [];
	const consumedTotals = {
		calories: 0,
		protein: 0,
		carbs: 0,
		fat: 0,
	};

	for (let mealIdx = 0; mealIdx < plannedMeals.length; mealIdx++) {
		const plannedMeal = plannedMeals[mealIdx];
		if (!plannedMeal) continue;

		const { scheduledTime } = getMealScheduleTime(plannedMeal.mealType);

		// Match logs to this meal slot via plannedMealRef.mealIndex
		const mealLogs = todayMealLogs.filter(
			(log: any) => log.plannedMealRef?.mealIndex === mealIdx,
		);

		// Foods from the plan (respects options[] fallback)
		const mealItems = getEffectiveMealItems(plannedMeal);
		const mealTotals = sumMacros(mealItems);

		// Consumed from logs — use the stored totals if available, else sum items
		const logTotals =
			mealLogs.length > 0
				? (() => {
						const combined = sumMacros(
							mealLogs.flatMap((log: any) => log.items || []),
						);
						return combined;
					})()
				: {
						caloriesKcal: 0,
						proteinG: 0,
						carbsG: 0,
						fatG: 0,
					};

		const status = determineMealStatus(mealLogs, scheduledTime, today);

		// For display totals: use logged if any logs present, else show planned
		const displayTotals = {
			calories:
				mealLogs.length > 0
					? logTotals.caloriesKcal
					: mealTotals.caloriesKcal,
			protein:
				mealLogs.length > 0 ? logTotals.proteinG : mealTotals.proteinG,
			carbs:
				mealLogs.length > 0 ? logTotals.carbsG : mealTotals.carbsG,
			fat: mealLogs.length > 0 ? logTotals.fatG : mealTotals.fatG,
		};

		// Only count toward consumed totals if meal is actually logged (not pending/skipped)
		if (
			status === MealLogStatus.Logged ||
			status === MealLogStatus.Partial
		) {
			consumedTotals.calories += logTotals.caloriesKcal;
			consumedTotals.protein += logTotals.proteinG;
			consumedTotals.carbs += logTotals.carbsG;
			consumedTotals.fat += logTotals.fatG;
		}

		todayMeals.push({
			mealType: plannedMeal.mealType,
			scheduledTime,
			status,
			foods: mealItems.map((item: any) => ({
				name: item.foodName,
				qty: item.quantityG,
				calories: item.caloriesKcal,
				protein: item.proteinG,
				carbs: item.carbsG,
				fat: item.fatG,
			})),
			totals: displayTotals,
		});
	}

	// ── Hydration from real log ─────────────────────────────────────────────
	const consumedWaterMl = todayHydration?.totalMl ?? 0;

	// ── Intake summary with over-target support ─────────────────────────────
	const intakeSummary = {
		calories: buildIntakeEntry(consumedTotals.calories, macroTargets.calories),
		protein: buildIntakeEntry(consumedTotals.protein, macroTargets.protein),
		carbs: buildIntakeEntry(consumedTotals.carbs, macroTargets.carbs),
		fat: buildIntakeEntry(consumedTotals.fat, macroTargets.fat),
		water: buildIntakeEntry(consumedWaterMl, macroTargets.water),
	};

	// ── Skipped meals ───────────────────────────────────────────────────────
	const skippedMeals = todayMeals
		.filter((meal) => meal.status === MealLogStatus.Skipped)
		.map((meal) => ({
			mealType: meal.mealType,
			scheduledTime: meal.scheduledTime,
		}));

	// ── Redistribution summary ──────────────────────────────────────────────
	const redistributionSummary: UserNutritionDashboard["redistributionSummary"] =
		[];

	for (const skippedMeal of skippedMeals) {
		const mealIndex = todayMeals.findIndex(
			(m) => m.mealType === skippedMeal.mealType,
		);
		if (mealIndex < 0) continue;

		const skippedMealData = todayMeals[mealIndex];
		if (!skippedMealData) continue;

		// Redistribute to next 1–2 upcoming (non-skipped) meals
		const redistributedTo = todayMeals
			.slice(mealIndex + 1)
			.filter((m) => m.status !== MealLogStatus.Skipped)
			.slice(0, 2)
			.map((m) => m.mealType);

		if (redistributedTo.length > 0) {
			redistributionSummary.push({
				skippedMeal: skippedMeal.mealType,
				redistributedTo,
				proteinRecovered: Math.round(
					skippedMealData.totals.protein / redistributedTo.length,
				),
				caloriesRecovered: Math.round(
					skippedMealData.totals.calories / redistributedTo.length,
				),
			});
		}
	}

	// ── Assemble response ───────────────────────────────────────────────────
	return {
		user: {
			_id: user._id.toString(),
			username: user.username,
			email: user.email,
			phone: user.phone,
			// Flat fields kept for backward compat with existing consumers
			weight: healthMarkers?.weight,
			height: healthMarkers?.height,
			goal: resolvedGoal,
			activityLevel: healthMarkers?.activityLevel as string | undefined,
			// ── Fields required by My Nutrition profile header cards ──
			age: typeof user.age === "number" ? user.age : null,
			gender: user.gender,
			healthGoals: Array.isArray(healthGoals?.goals) && healthGoals.goals.length > 0
				? healthGoals.goals
				: Array.isArray((user as any).healthGoals) && (user as any).healthGoals.length > 0
					? (user as any).healthGoals
					: [],
			healthMarkers: {
				weight: healthMarkers?.weight,
				height: healthMarkers?.height,
				gender: healthMarkers ? String(user.gender ?? "") : undefined,
				activityLevel: healthMarkers?.activityLevel as string | undefined,
			},
		},
		assignedPlan: activePlan
			? {
					_id: activePlan._id.toString(),
					name: activePlan.name,
					goal: activePlan.goal,
					status: activePlan.status,
					mealsPerDay: plannedMeals.length,
					durationDays: activePlan.durationDays || 7,
					startDate: activePlan.startDate,
					assignedByNutritionist: activePlan.nutritionistId
						? activePlan.nutritionistId.toString()
						: undefined,
				}
			: undefined,
		macroTargets,
		targetSource: targetResult.source,
		intakeSummary,
		todayMeals,
		skippedMeals,
		redistributionSummary,
	};
};
