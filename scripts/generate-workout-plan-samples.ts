/**
 * Generate the Excel workout-plan template and three filled sample plans,
 * offline, from the seeded system exercise library (scripts/seed-exercises.ts).
 * No database needed.
 *
 *   bun run scripts/generate-workout-plan-samples.ts [outDir]
 *
 * Every sample is re-parsed with the real importer before it is written, so a
 * file that would not import fails the script instead of reaching a trainer.
 * The templates trainers download in FrontDesk (GET /workout-plans/import/template)
 * list the live library instead of the seed list.
 */
import fs from "node:fs";
import path from "node:path";
import {
	ExerciseDifficulty,
	ExerciseSection,
	MuscleGroup,
} from "../src/models/Enums";
import {
	buildWorkoutPlanTemplate,
	type LibraryExercise,
	parseWorkoutPlanWorkbook,
	type Row,
	type TemplatePrefill,
} from "../src/utils/workout-plan-excel";

/** Evaluate the `systemExercises` literal without running the seed's DB code. */
function loadSeedLibrary(): LibraryExercise[] {
	const src = fs.readFileSync(
		path.join(import.meta.dir, "seed-exercises.ts"),
		"utf8",
	);
	const start = src.indexOf("const systemExercises = [");
	const end = src.indexOf("\n];", start);
	if (start < 0 || end < 0) throw new Error("systemExercises not found");
	const literal = src.slice(src.indexOf("[", start), end + 2);
	const list = new Function(
		"MuscleGroup",
		"ExerciseDifficulty",
		"ExerciseSection",
		`return ${literal};`,
	)(MuscleGroup, ExerciseDifficulty, ExerciseSection) as Array<
		Omit<LibraryExercise, "_id">
	>;
	return list.map((e, i) => ({ ...e, _id: `seed-${i}`, isSystem: true }));
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

type Section = "Warmup" | "Workout" | "Stretching";
interface Ex {
	section: Section;
	name: string;
	sets: number;
	reps?: number;
	kg?: number;
	rest?: number;
	sec?: number;
	notes?: string;
}

const warm = (name: string, sets: number, opts: Partial<Ex> = {}): Ex => ({
	section: "Warmup",
	name,
	sets,
	rest: 15,
	...opts,
});
const lift = (name: string, sets: number, opts: Partial<Ex> = {}): Ex => ({
	section: "Workout",
	name,
	sets,
	...opts,
});
const stretch = (name: string, sec = 45, opts: Partial<Ex> = {}): Ex => ({
	section: "Stretching",
	name,
	sets: 1,
	sec,
	rest: 0,
	...opts,
});

const dayRows = (day: number, name: string, exercises: Ex[]): Row[] =>
	exercises.map((e, i) => [
		day,
		i === 0 ? name : null,
		null,
		e.section,
		e.name,
		e.sets,
		e.reps ?? null,
		e.kg ?? null,
		e.rest ?? 60,
		e.sec ?? null,
		e.notes ?? null,
	]);

const restRow = (day: number, name = "Rest"): Row[] => [[day, name, "Yes"]];

/** Round to the nearest 0.5 kg — the smallest plate step most gyms offer. */
const plate = (kg: number) => Math.round(kg * 2) / 2;

// ─── Sample 1: beginner full body, one week ───────────────────────────────────

function beginnerFullBody(): TemplatePrefill {
	return {
		details: {
			name: "Beginner Full Body — 1 Week",
			description:
				"Three full-body sessions with rest days between and one mobility day. Good first plan for new members.",
			difficulty: "Beginner",
			duration: 1,
			goal: "GeneralFitness",
			splitType: "FullBody",
			isTemplate: "Yes",
			templateCategory: "Beginner",
			status: "Active",
		},
		rows: [
			...dayRows(1, "Full Body A", [
				warm("Jumping Jacks", 2, { sec: 45 }),
				warm("Arm Circles", 1, { sec: 30, rest: 0 }),
				lift("Goblet Squats", 3, {
					reps: 12,
					kg: 8,
					notes: "Chest up, sit between the heels",
				}),
				lift("Push Ups", 3, {
					reps: 10,
					notes: "Drop to knees if form breaks",
				}),
				lift("Single Arm Dumbbell Row", 3, {
					reps: 12,
					kg: 10,
					notes: "12 each arm",
				}),
				lift("Plank Hold", 3, { sec: 30, rest: 45 }),
				stretch("Hamstring Stretch"),
				stretch("Child Pose"),
			]),
			...restRow(2),
			...dayRows(3, "Full Body B", [
				warm("High Knees", 2, { sec: 30 }),
				warm("Leg Swings", 1, {
					sec: 30,
					rest: 0,
					notes: "Front-to-back and side-to-side",
				}),
				lift("Bodyweight Lunges", 3, { reps: 10, notes: "10 each leg" }),
				lift("Lat Pulldown", 3, { reps: 12, kg: 25 }),
				lift("Incline Dumbbell Press", 3, { reps: 10, kg: 8 }),
				lift("Hip Thrusts", 3, { reps: 12, kg: 20 }),
				lift("Side Plank", 2, { sec: 20, rest: 30, notes: "Each side" }),
				stretch("Quad Stretch"),
				stretch("Cobra Stretch", 30),
			]),
			...restRow(4),
			...dayRows(5, "Full Body C", [
				warm("Jump Rope", 2, { sec: 60 }),
				warm("Inchworms", 1, { reps: 6, rest: 0 }),
				lift("Romanian Deadlifts", 3, {
					reps: 10,
					kg: 15,
					notes: "Soft knees, hinge at the hips",
				}),
				lift("Overhead Press", 3, { reps: 10, kg: 15 }),
				lift("Seated Cable Row", 3, { reps: 12, kg: 25 }),
				lift("Bicycle Crunches", 3, { reps: 20, rest: 45 }),
				lift("Mountain Climbers", 3, { sec: 30, rest: 45 }),
				stretch("Downward Dog"),
				stretch("Butterfly Stretch"),
			]),
			...dayRows(6, "Active Recovery", [
				warm("Hip Circles", 1, { sec: 30 }),
				warm("Shoulder Rolls", 1, { sec: 30, rest: 0 }),
				stretch("World's Greatest Stretch", 0, {
					sets: 2,
					reps: 5,
					sec: undefined,
					notes: "5 each side",
				}),
				stretch("Cat-Cow Stretch", 0, { sets: 2, reps: 10, sec: undefined }),
				stretch("Pigeon Pose", 60, { notes: "Each side" }),
				stretch("Thread the Needle"),
				stretch("Supine Spinal Twist"),
			]),
			...restRow(7),
		],
	};
}

// ─── Sample 2: push / pull / legs, two weeks with progression ─────────────────

function pushPullLegs(): TemplatePrefill {
	const push = (load: number, note?: string): Ex[] => [
		warm("Arm Circles", 1, { sec: 30 }),
		warm("Shoulder Rolls", 1, { sec: 30, rest: 0 }),
		lift("Bench Press", 4, {
			reps: 8,
			kg: plate(60 * load),
			rest: 120,
			notes: note,
		}),
		lift("Incline Dumbbell Press", 3, {
			reps: 10,
			kg: plate(22 * load),
			rest: 90,
		}),
		lift("Overhead Press", 3, { reps: 8, kg: plate(35 * load), rest: 90 }),
		lift("Lateral Raises", 3, { reps: 15, kg: plate(8 * load) }),
		lift("Cable Crossover", 3, { reps: 12, kg: plate(15 * load) }),
		lift("Tricep Pushdowns", 3, { reps: 12, kg: plate(25 * load) }),
		lift("Overhead Tricep Extension", 3, { reps: 12, kg: plate(16 * load) }),
		stretch("Doorway Chest Stretch"),
		stretch("Triceps Stretch", 30),
	];
	const pull = (load: number, note?: string): Ex[] => [
		warm("Torso Twists", 1, { sec: 30 }),
		warm("Arm Circles", 1, { sec: 30, rest: 0 }),
		lift("Deadlifts", 4, {
			reps: 5,
			kg: plate(100 * load),
			rest: 180,
			notes: note,
		}),
		lift("Pull Ups", 4, {
			reps: 8,
			rest: 120,
			notes: "Use band assistance if needed",
		}),
		lift("Bent Over Barbell Row", 3, {
			reps: 10,
			kg: plate(50 * load),
			rest: 90,
		}),
		lift("Lat Pulldown", 3, { reps: 12, kg: plate(45 * load) }),
		lift("Face Pulls", 3, { reps: 15, kg: plate(15 * load) }),
		lift("Hammer Curls", 3, { reps: 12, kg: plate(12 * load) }),
		lift("Preacher Curls", 3, { reps: 12, kg: plate(20 * load) }),
		stretch("Cross-Body Shoulder Stretch", 30, { notes: "Each arm" }),
		stretch("Child Pose"),
	];
	const legs = (load: number, note?: string): Ex[] => [
		warm("Leg Swings", 1, { sec: 30 }),
		warm("Hip Circles", 1, { sec: 30 }),
		warm("Bodyweight Squats", 1, { reps: 15, rest: 30 }),
		lift("Barbell Squats", 4, {
			reps: 8,
			kg: plate(80 * load),
			rest: 150,
			notes: note,
		}),
		lift("Romanian Deadlifts", 3, { reps: 10, kg: plate(60 * load), rest: 90 }),
		lift("Leg Press", 3, { reps: 12, kg: plate(120 * load), rest: 90 }),
		lift("Bulgarian Split Squats", 3, {
			reps: 10,
			kg: plate(12 * load),
			notes: "10 each leg",
		}),
		lift("Lying Leg Curls", 3, { reps: 12, kg: plate(30 * load) }),
		lift("Standing Calf Raises", 4, {
			reps: 15,
			kg: plate(40 * load),
			rest: 45,
		}),
		lift("Hanging Leg Raises", 3, { reps: 12 }),
		stretch("Quad Stretch"),
		stretch("Hip Flexor Stretch"),
		stretch("Standing Calf Stretch", 30),
	];

	const rows: Row[] = [];
	for (const week of [1, 2]) {
		const load = week === 1 ? 1 : 1.05;
		const note = week === 2 ? "Week 2: about +5% load" : undefined;
		const d = (n: number) => (week - 1) * 7 + n;
		rows.push(
			...dayRows(d(1), `Push ${week === 1 ? "A" : "B"}`, push(load, note)),
			...dayRows(d(2), `Pull ${week === 1 ? "A" : "B"}`, pull(load, note)),
			...dayRows(d(3), `Legs ${week === 1 ? "A" : "B"}`, legs(load, note)),
			...restRow(d(4)),
			...dayRows(d(5), "Push (volume)", push(load * 0.9)),
			...dayRows(d(6), "Pull (volume)", pull(load * 0.9)),
			...dayRows(d(7), "Legs (volume)", legs(load * 0.9)),
		);
	}

	return {
		details: {
			name: "Push Pull Legs — 2 Weeks",
			description:
				"Six sessions a week: heavy push/pull/legs, a rest day, then lighter volume days. Week 2 adds about 5% load.",
			difficulty: "Intermediate",
			duration: 2,
			goal: "Hypertrophy",
			splitType: "PushPullLegs",
			isTemplate: "Yes",
			templateCategory: "Muscle Gain",
			status: "Active",
		},
		rows,
	};
}

// ─── Sample 3: fat-loss circuits, four weeks ──────────────────────────────────

function fatLossCircuit(): TemplatePrefill {
	const rows: Row[] = [];
	for (let week = 1; week <= 4; week++) {
		const sets = week >= 3 ? 4 : 3;
		const hold = 30 + (week - 1) * 5;
		const d = (n: number) => (week - 1) * 7 + n;
		const tag = `Week ${week}`;
		rows.push(
			...dayRows(d(1), `${tag} · Circuit A`, [
				warm("Jumping Jacks", 2, { sec: 45 }),
				warm("Butt Kicks", 1, { sec: 30, rest: 0 }),
				lift("Burpees", sets, {
					reps: 10,
					rest: 30,
					notes: "Move straight to the next exercise",
				}),
				lift("Kettlebell Swings", sets, { reps: 15, kg: 12, rest: 30 }),
				lift("Goblet Squats", sets, { reps: 15, kg: 10, rest: 30 }),
				lift("Push Ups", sets, { reps: 12, rest: 30 }),
				lift("Mountain Climbers", sets, {
					sec: hold,
					rest: 90,
					notes: "Rest 90 s after this, then repeat the circuit",
				}),
				stretch("Hamstring Stretch"),
			]),
			...dayRows(d(2), `${tag} · Cardio & Core`, [
				lift("Jump Rope", 5, { sec: 60, rest: 30 }),
				lift("High Knees", 3, { sec: hold, rest: 30 }),
				lift("Side Shuffles", 3, { sec: hold, rest: 30 }),
				lift("Russian Twists", 3, { reps: 20, rest: 30 }),
				lift("Crunches", 3, { reps: 20, rest: 30 }),
				lift("Plank Hold", 3, { sec: hold + 10, rest: 30 }),
				stretch("Cobra Stretch", 30),
			]),
			...restRow(d(3)),
			...dayRows(d(4), `${tag} · Circuit B`, [
				warm("Inchworms", 1, { reps: 6 }),
				warm("Walking Knee Hugs", 1, { reps: 10, rest: 0 }),
				lift("Bodyweight Lunges", sets, {
					reps: 12,
					rest: 30,
					notes: "12 each leg",
				}),
				lift("Single Arm Dumbbell Row", sets, {
					reps: 12,
					kg: 12,
					rest: 30,
					notes: "12 each arm",
				}),
				lift("Hip Thrusts", sets, { reps: 15, kg: 30, rest: 30 }),
				lift("Front Raises", sets, { reps: 12, kg: 6, rest: 30 }),
				lift("Bicycle Crunches", sets, { reps: 20, rest: 30 }),
				lift("Burpees", sets, { reps: 8, rest: 90 }),
				stretch("Figure Four Stretch", 45, { notes: "Each side" }),
				stretch("Seated Forward Fold"),
			]),
			...dayRows(d(5), `${tag} · Cardio & Core`, [
				lift("Jump Rope", 5, { sec: 60, rest: 30 }),
				lift("Mountain Climbers", 3, { sec: hold, rest: 30 }),
				lift("Side Plank", 2, { sec: hold, rest: 30, notes: "Each side" }),
				lift("Hanging Leg Raises", 3, { reps: 10, rest: 45 }),
				lift("Bicycle Crunches", 3, { reps: 20, rest: 30 }),
				stretch("Cobra Stretch", 30),
			]),
			...dayRows(d(6), `${tag} · Mobility`, [
				stretch("Cat-Cow Stretch", 0, { sets: 2, reps: 10, sec: undefined }),
				stretch("World's Greatest Stretch", 0, {
					sets: 2,
					reps: 5,
					sec: undefined,
					notes: "5 each side",
				}),
				stretch("Pigeon Pose", 60, { notes: "Each side" }),
				stretch("Seated Spinal Twist"),
				stretch("Standing Side Stretch", 30),
				stretch("Neck Stretch", 30),
			]),
			...restRow(d(7)),
		);
	}

	return {
		details: {
			name: "Fat Loss Circuit — 4 Weeks",
			description:
				"Two strength circuits, two cardio-and-core days and a mobility day each week. Weeks 3–4 add a fourth round and longer holds.",
			difficulty: "Beginner",
			duration: 4,
			goal: "WeightLoss",
			splitType: "FullBody",
			isTemplate: "Yes",
			templateCategory: "Fat Loss",
			status: "Active",
		},
		rows,
	};
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const outDir = path.resolve(process.argv[2] ?? "workout-plan-samples");
fs.mkdirSync(outDir, { recursive: true });

const library = loadSeedLibrary();
console.log(`Seed library: ${library.length} exercises`);

const blank = buildWorkoutPlanTemplate(library);
fs.writeFileSync(path.join(outDir, "workout-plan-template.xlsx"), blank);
console.log("✔ workout-plan-template.xlsx (blank)");

const samples: [string, TemplatePrefill][] = [
	["sample-1-beginner-full-body-1-week.xlsx", beginnerFullBody()],
	["sample-2-push-pull-legs-2-weeks.xlsx", pushPullLegs()],
	["sample-3-fat-loss-circuit-4-weeks.xlsx", fatLossCircuit()],
];

let failed = false;
for (const [file, prefill] of samples) {
	const buffer = buildWorkoutPlanTemplate(library, prefill);
	const { plan, errors, warnings } = parseWorkoutPlanWorkbook(buffer, library);
	if (errors.length > 0 || !plan) {
		failed = true;
		console.error(`✘ ${file} does not import:`);
		for (const e of errors)
			console.error(
				`   ${e.sheet} ${e.column ?? ""}${e.row ?? ""}: ${e.message}`,
			);
		continue;
	}
	fs.writeFileSync(path.join(outDir, file), buffer);
	const exercises = plan.days.reduce((n, d) => n + d.exercises.length, 0);
	console.log(
		`✔ ${file}: ${plan.days.length} days, ${exercises} exercises${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
	);
}

if (failed) process.exit(1);
console.log(`\nWritten to ${outDir}`);
