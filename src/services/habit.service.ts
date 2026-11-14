import mongoose from "mongoose";
import { HabitCategory, HabitFrequency, HabitLogSource } from "../models/Enums";
import Habit from "../models/Habit";
import HabitLog from "../models/HabitLog";
import { DEFAULT_TIMEZONE, formatDateInZone } from "../utils/timezone.util";
import type {
	CreateHabitInput,
	ToggleHabitInput,
	UpdateHabitInput,
} from "../validators/habit.validator";

export interface HabitCatalogItem {
	category: HabitCategory;
	title: string;
	description: string;
	icon: string;
	timeOfDayHint: "MORNING" | "ANYTIME" | "EVENING";
	scienceSummary: string;
}

export const CURATED_HABIT_CATALOG: HabitCatalogItem[] = [
	// Sleep & Circadian
	{
		category: HabitCategory.Sleep,
		title: "Screens Off Before Bed",
		description: "Screens off 45 mins before sleep",
		icon: "bedtime",
		timeOfDayHint: "EVENING",
		scienceSummary:
			"Blue light suppression allows natural melatonin secretion, facilitating restorative REM and deep slow-wave sleep.",
	},
	{
		category: HabitCategory.Sleep,
		title: "Sleep at the Same Time",
		description: "Sleep within a 30-min window every night",
		icon: "bed",
		timeOfDayHint: "EVENING",
		scienceSummary:
			"Stabilizes central circadian clock in the hypothalamus, optimizing overnight tissue recovery.",
	},
	// Hydration & Nutrition
	{
		category: HabitCategory.Hydration,
		title: "Morning Metabolic Prime",
		description: "Drink 500ml water upon waking",
		icon: "water_drop",
		timeOfDayHint: "MORNING",
		scienceSummary:
			"Rapidly rehydrates cellular volume and jumpstarts kidney filtration after an 8-hour overnight fast.",
	},
	{
		category: HabitCategory.Nutrition,
		title: "Protein with Every Meal",
		description: "Include a palm of protein in breakfast, lunch & dinner",
		icon: "restaurant",
		timeOfDayHint: "ANYTIME",
		scienceSummary:
			"Sustains muscle protein synthesis throughout the day, preventing age-related sarcopenia.",
	},
	{
		category: HabitCategory.Nutrition,
		title: "Eat Until 80% Full",
		description: "Hara Hachi Bu: stop when comfortably satisfied",
		icon: "soup_kitchen",
		timeOfDayHint: "ANYTIME",
		scienceSummary:
			"Prevents post-prandial glycemic spikes and promotes metabolic longevity and digestive efficiency.",
	},
	// Movement & NEAT
	{
		category: HabitCategory.Movement,
		title: "Daily Active Baseline",
		description: "8,000 steps or 30m brisk movement",
		icon: "directions_walk",
		timeOfDayHint: "ANYTIME",
		scienceSummary:
			"Maintains non-exercise activity thermogenesis (NEAT), cardiovascular elasticity, and insulin sensitivity.",
	},
	{
		category: HabitCategory.Movement,
		title: "10-Min Post-Meal Walk",
		description: "Gentle stroll within 30 mins after lunch or dinner",
		icon: "nature_people",
		timeOfDayHint: "ANYTIME",
		scienceSummary:
			"Dramatically reduces postprandial glucose and insulin excursions by contracting leg muscles.",
	},
	{
		category: HabitCategory.Movement,
		title: "Morning Sunlight Exposure",
		description: "15 mins outdoor sunlight before 10 AM",
		icon: "wb_sunny",
		timeOfDayHint: "MORNING",
		scienceSummary:
			"Photons hitting retinal ganglion cells set the circadian rhythm timer for optimal evening sleep drive.",
	},
	// Recovery & Mindfulness
	{
		category: HabitCategory.Recovery,
		title: "5-Min Deep Breathing",
		description: "Inhale 4s, hold 4s, exhale 4s, hold 4s",
		icon: "self_improvement",
		timeOfDayHint: "ANYTIME",
		scienceSummary:
			"Downregulates sympathetic fight-or-flight nervous system and elevates vagal tone.",
	},
	{
		category: HabitCategory.Recovery,
		title: "Cold Shower / Plunge (2 Min)",
		description: "End shower with 2 minutes of cold water",
		icon: "ac_unit",
		timeOfDayHint: "MORNING",
		scienceSummary:
			"Triggers norepinephrine release, stimulates mitochondrial biogenesis, and enhances resilience.",
	},
];

export async function ensureDefaultHabits(userId: string): Promise<void> {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const count = await Habit.countDocuments({
		userId: userObjectId,
		isActive: true,
	});
	if (count > 0) return;

	// Seed the 3 default longevity habits
	const defaultHabits = [
		{
			userId: userObjectId,
			title: "Morning Metabolic Prime",
			description: "Drink 500ml water upon waking",
			category: HabitCategory.Hydration,
			icon: "water_drop",
			isDefault: true,
			isPinnedToHome: true,
			pinnedOrder: 1,
			timeOfDayHint: "MORNING",
			frequency: HabitFrequency.Daily,
			targetDaysPerWeek: 7,
		},
		{
			userId: userObjectId,
			title: "Daily Active Baseline",
			description: "8,000 steps or 30m brisk movement",
			category: HabitCategory.Movement,
			icon: "directions_walk",
			isDefault: true,
			isPinnedToHome: true,
			pinnedOrder: 2,
			timeOfDayHint: "ANYTIME",
			frequency: HabitFrequency.Daily,
			targetDaysPerWeek: 7,
		},
		{
			userId: userObjectId,
			title: "Screens Off Before Bed",
			description: "Screens off 45 mins before sleep",
			category: HabitCategory.Sleep,
			icon: "bedtime",
			isDefault: true,
			isPinnedToHome: true,
			pinnedOrder: 3,
			timeOfDayHint: "EVENING",
			frequency: HabitFrequency.Daily,
			targetDaysPerWeek: 7,
		},
	];

	// Update any existing habits with previous legacy titles
	await migrateLegacyHabitTitles(userObjectId);

	await Habit.insertMany(defaultHabits);
}

async function migrateLegacyHabitTitles(userObjectId: mongoose.Types.ObjectId): Promise<void> {
	await Habit.updateMany(
		{ userId: userObjectId, title: "Evening Circadian Reset" },
		{ $set: { title: "Screens Off Before Bed" } },
	);
	await Habit.updateMany(
		{ userId: userObjectId, title: "Consistent Bedtime Window" },
		{ $set: { title: "Sleep at the Same Time" } },
	);
	await Habit.updateMany(
		{ userId: userObjectId, title: "5-Min Box Breathing" },
		{ $set: { title: "5-Min Deep Breathing" } },
	);
}

export async function getTodayHabits(
	userId: string,
	targetDateStr?: string,
) {
	await ensureDefaultHabits(userId);

	const userObjectId = new mongoose.Types.ObjectId(userId);
	await migrateLegacyHabitTitles(userObjectId);

	const todayStr =
		targetDateStr || formatDateInZone(new Date(), DEFAULT_TIMEZONE);

	// Fetch pinned habits for Home (capped at 3)
	const pinnedHabits = await Habit.find({
		userId: userObjectId,
		isActive: true,
		isPinnedToHome: true,
	})
		.sort({ pinnedOrder: 1, createdAt: 1 })
		.limit(3)
		.lean();

	const habitIds = pinnedHabits.map((h) => h._id);

	// Fetch logs for these habits on todayStr
	const logs = await HabitLog.find({
		habitId: { $in: habitIds },
		userId: userObjectId,
		date: todayStr,
		completed: true,
	}).lean();

	const completedMap = new Map<string, (typeof logs)[0]>();
	for (const log of logs) {
		completedMap.set(log.habitId.toString(), log);
	}

	const habitItems = pinnedHabits.map((h) => {
		const log = completedMap.get(h._id.toString());
		return {
			id: h._id.toString(),
			title: h.title,
			description: h.description,
			category: h.category,
			icon: h.icon,
			timeOfDayHint: h.timeOfDayHint,
			isCompleted: Boolean(log),
			completedAt: log?.completedAt,
			source: log?.source || HabitLogSource.Manual,
			currentStreak: h.currentStreak || 0,
			longestStreak: h.longestStreak || 0,
		};
	});

	const completedCount = habitItems.filter((h) => h.isCompleted).length;
	const totalCount = habitItems.length;

	// Overall streak: maximum of current active streaks
	const overallStreak = habitItems.reduce(
		(max, h) => Math.max(max, h.currentStreak),
		0,
	);

	return {
		date: todayStr,
		summary: {
			totalCount,
			completedCount,
			isAllCompleted: totalCount > 0 && completedCount === totalCount,
			streak: overallStreak,
		},
		habits: habitItems,
	};
}

export async function toggleHabit(
	userId: string,
	input: ToggleHabitInput,
) {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const habitObjectId = new mongoose.Types.ObjectId(input.habitId);
	const dateStr =
		input.date || formatDateInZone(new Date(), DEFAULT_TIMEZONE);

	const habit = await Habit.findOne({
		_id: habitObjectId,
		userId: userObjectId,
	});

	if (!habit) {
		throw new Error("Habit not found");
	}

	const existingLog = await HabitLog.findOne({
		habitId: habitObjectId,
		userId: userObjectId,
		date: dateStr,
	});

	let isCompleted: boolean;

	if (existingLog && existingLog.completed) {
		// Toggle OFF
		await HabitLog.deleteOne({ _id: existingLog._id });
		isCompleted = false;
	} else {
		// Toggle ON
		await HabitLog.findOneAndUpdate(
			{ habitId: habitObjectId, date: dateStr },
			{
				userId: userObjectId,
				completed: true,
				completedAt: new Date(),
				source: input.source || HabitLogSource.Manual,
			},
			{ upsert: true, new: true },
		);
		isCompleted = true;
	}

	// Recalculate streak for this habit
	const allCompletedLogs = await HabitLog.find({
		habitId: habitObjectId,
		completed: true,
	})
		.sort({ date: -1 })
		.select("date")
		.lean();

	const completedDates = new Set(allCompletedLogs.map((l) => l.date));

	// Walk backwards day-by-day from today/yesterday to calculate consecutive streak
	let streak = 0;
	let cursor = new Date();
	let cursorStr = formatDateInZone(cursor, DEFAULT_TIMEZONE);

	// If today is completed, streak starts today. If not, check if yesterday was completed
	if (!completedDates.has(cursorStr)) {
		cursor = new Date(cursor.getTime() - 86400000);
		cursorStr = formatDateInZone(cursor, DEFAULT_TIMEZONE);
	}

	while (completedDates.has(cursorStr)) {
		streak += 1;
		cursor = new Date(cursor.getTime() - 86400000);
		cursorStr = formatDateInZone(cursor, DEFAULT_TIMEZONE);
	}

	habit.currentStreak = streak;
	habit.longestStreak = Math.max(habit.longestStreak || 0, streak);
	habit.totalCompletions = allCompletedLogs.length;
	await habit.save();

	return {
		habitId: habit._id.toString(),
		date: dateStr,
		completed: isCompleted,
		currentStreak: habit.currentStreak,
		longestStreak: habit.longestStreak,
		totalCompletions: habit.totalCompletions,
	};
}

export async function getMyHabits(userId: string) {
	await ensureDefaultHabits(userId);

	const userObjectId = new mongoose.Types.ObjectId(userId);
	await migrateLegacyHabitTitles(userObjectId);

	const habits = await Habit.find({
		userId: userObjectId,
		isActive: true,
	})
		.sort({ isPinnedToHome: -1, pinnedOrder: 1, createdAt: 1 })
		.lean();

	const habitIds = habits.map((h) => h._id);

	// Fetch completed logs for the past 30 days
	const past30DaysDate = new Date(Date.now() - 30 * 86400000);
	const past30Str = formatDateInZone(past30DaysDate, DEFAULT_TIMEZONE);

	const recentLogs = await HabitLog.find({
		habitId: { $in: habitIds },
		userId: userObjectId,
		date: { $gte: past30Str },
		completed: true,
	}).lean();

	const logsByHabit = new Map<string, string[]>();
	for (const log of recentLogs) {
		const arr = logsByHabit.get(log.habitId.toString()) || [];
		arr.push(log.date);
		logsByHabit.set(log.habitId.toString(), arr);
	}

	return habits.map((h) => ({
		id: h._id.toString(),
		title: h.title,
		description: h.description,
		category: h.category,
		icon: h.icon,
		isDefault: h.isDefault,
		isPinnedToHome: h.isPinnedToHome,
		pinnedOrder: h.pinnedOrder,
		timeOfDayHint: h.timeOfDayHint,
		currentStreak: h.currentStreak || 0,
		longestStreak: h.longestStreak || 0,
		totalCompletions: h.totalCompletions || 0,
		recentCompletedDates: logsByHabit.get(h._id.toString()) || [],
	}));
}

export async function createCustomHabit(
	userId: string,
	input: CreateHabitInput,
) {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const newHabit = await Habit.create({
		userId: userObjectId,
		title: input.title,
		description: input.description || "",
		category: input.category,
		icon: input.icon,
		timeOfDayHint: input.timeOfDayHint,
		frequency: input.frequency,
		targetDaysPerWeek: input.targetDaysPerWeek,
		isPinnedToHome: input.isPinnedToHome,
		isDefault: false,
	});

	return newHabit;
}

export async function updateHabit(
	userId: string,
	habitId: string,
	input: UpdateHabitInput,
) {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const habitObjectId = new mongoose.Types.ObjectId(habitId);

	const habit = await Habit.findOneAndUpdate(
		{ _id: habitObjectId, userId: userObjectId },
		{ $set: input },
		{ new: true },
	);

	if (!habit) {
		throw new Error("Habit not found");
	}

	return habit;
}

export function getCuratedCatalog() {
	return CURATED_HABIT_CATALOG;
}
