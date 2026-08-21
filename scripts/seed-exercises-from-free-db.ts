import { config } from "dotenv";
import mongoose from "mongoose";
import {
	ExerciseDifficulty,
	ExerciseSection,
	MuscleGroup,
} from "../src/models/Enums";
import Exercise from "../src/models/Exercise";
import connectDB from "../src/utils/db";

config();

// yuhonas/free-exercise-db — public domain. Images hosted on jsDelivr.
const SOURCE_JSON =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const IMAGE_CDN =
	"https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises";

interface SourceExercise {
	id: string;
	name: string;
	force: string | null;
	level: "beginner" | "intermediate" | "expert";
	mechanic: string | null;
	equipment: string | null;
	primaryMuscles: string[];
	secondaryMuscles: string[];
	instructions: string[];
	category: string;
	images: string[];
}

// Source muscle strings → our MuscleGroup enum. Anything unmapped is skipped
// (defensive) so a row without a valid primary group is not persisted.
const MUSCLE_MAP: Record<string, MuscleGroup> = {
	abdominals: MuscleGroup.Core,
	abductors: MuscleGroup.Legs,
	adductors: MuscleGroup.Legs,
	biceps: MuscleGroup.Arms,
	calves: MuscleGroup.Legs,
	chest: MuscleGroup.Chest,
	forearms: MuscleGroup.Arms,
	glutes: MuscleGroup.Legs,
	hamstrings: MuscleGroup.Legs,
	lats: MuscleGroup.Back,
	"lower back": MuscleGroup.Back,
	"middle back": MuscleGroup.Back,
	neck: MuscleGroup.FullBody,
	quadriceps: MuscleGroup.Legs,
	shoulders: MuscleGroup.Shoulders,
	traps: MuscleGroup.Back,
	triceps: MuscleGroup.Arms,
};

const LEVEL_MAP: Record<SourceExercise["level"], ExerciseDifficulty> = {
	beginner: ExerciseDifficulty.Beginner,
	intermediate: ExerciseDifficulty.Intermediate,
	expert: ExerciseDifficulty.Advanced,
};

const titleCase = (s: string) =>
	s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();

interface Mapped {
	name: string;
	muscleGroups: MuscleGroup[];
	targetedMuscles: string[];
	difficulty: ExerciseDifficulty;
	equipment: string;
	instructions: string;
	sectionTypes: ExerciseSection[];
	imageUrl: string | null;
	imageUrls: string[];
	isSystem: true;
	createdBy: null;
}

function mapExercise(src: SourceExercise): Mapped | null {
	const groups = Array.from(
		new Set(
			src.primaryMuscles
				.map((m) => MUSCLE_MAP[m.toLowerCase()])
				.filter((g): g is MuscleGroup => Boolean(g)),
		),
	);
	if (groups.length === 0) return null;

	const targeted = Array.from(
		new Set(
			[...src.primaryMuscles, ...src.secondaryMuscles].map(titleCase),
		),
	).slice(0, 10);

	const equipment =
		!src.equipment || src.equipment === "body only"
			? "Bodyweight"
			: titleCase(src.equipment);

	const instructions = src.instructions.join(" ").slice(0, 5000);

	const imageUrls = src.images.map((p) => `${IMAGE_CDN}/${p}`);

	return {
		name: src.name.slice(0, 100),
		muscleGroups: groups,
		targetedMuscles: targeted.length > 0 ? targeted : [titleCase(src.primaryMuscles[0] ?? "General")],
		difficulty: LEVEL_MAP[src.level] ?? ExerciseDifficulty.Beginner,
		equipment,
		instructions,
		sectionTypes: [ExerciseSection.Workout],
		imageUrl: imageUrls[0] ?? null,
		imageUrls,
		isSystem: true,
		createdBy: null,
	};
}

async function seed() {
	await connectDB();

	console.log(`Fetching ${SOURCE_JSON}...`);
	const res = await fetch(SOURCE_JSON);
	if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
	const rows = (await res.json()) as SourceExercise[];
	console.log(`Loaded ${rows.length} exercises from source`);

	let skipped = 0;
	const ops: any[] = [];
	for (const row of rows) {
		const mapped = mapExercise(row);
		if (!mapped) {
			skipped++;
			continue;
		}
		// $setOnInsert everything for NEW rows; only overwrite images on
		// existing rows so the curated commonMistakes/tips from the
		// original seed are preserved.
		const { imageUrl, imageUrls, ...onInsertOnly } = mapped;
		ops.push({
			updateOne: {
				filter: { name: mapped.name, isSystem: true },
				update: {
					$set: { imageUrl, imageUrls },
					$setOnInsert: onInsertOnly,
				},
				upsert: true,
			},
		});
	}

	console.log(`Writing ${ops.length} upserts (skipped ${skipped} unmapped)...`);
	const result = await Exercise.bulkWrite(ops);
	console.log(
		`Seed complete: ${result.upsertedCount} created, ${result.modifiedCount} updated`,
	);

	// Duplicate cleanup — mirrors scripts/seed-exercises.ts.
	console.log("Checking for duplicate system exercises...");
	const duplicateGroups: Array<{
		_id: string;
		docs: Array<{ id: mongoose.Types.ObjectId; updatedAt?: Date }>;
	}> = await Exercise.aggregate([
		{ $match: { isSystem: true } },
		{
			$group: {
				_id: { $toLower: { $trim: { input: "$name" } } },
				docs: { $push: { id: "$_id", updatedAt: "$updatedAt" } },
				count: { $sum: 1 },
			},
		},
		{ $match: { count: { $gt: 1 } } },
	]);

	let removedCount = 0;
	for (const group of duplicateGroups) {
		const sorted = [...group.docs].sort(
			(a, b) =>
				new Date(b.updatedAt ?? 0).getTime() -
				new Date(a.updatedAt ?? 0).getTime(),
		);
		const idsToDelete = sorted.slice(1).map((doc) => doc.id);
		const deleted = await Exercise.deleteMany({ _id: { $in: idsToDelete } });
		removedCount += deleted.deletedCount;
		console.log(
			`  Removed ${deleted.deletedCount} duplicate(s) of "${group._id}"`,
		);
	}
	console.log(
		removedCount > 0
			? `Duplicate cleanup complete: ${removedCount} removed`
			: "No duplicates found.",
	);

	await mongoose.disconnect();
	console.log("Done.");
}

seed().catch((error) => {
	console.error("Seed failed:", error);
	process.exit(1);
});
