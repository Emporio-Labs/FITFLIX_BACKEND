/**
 * Pure-function coverage for the Excel workout-plan import
 * (utils/workout-plan-excel.ts). No server, no database: workbooks are built
 * in memory and parsed against a fake exercise library.
 */
import XLSX from "xlsx";
import {
	buildWorkoutPlanTemplate,
	type LibraryExercise,
	parseWorkoutPlanWorkbook,
} from "../src/utils/workout-plan-excel";
import { createPlanBodySchema } from "../src/validators/workout-plan.validator";
import { assert } from "./test-helpers";

const LIBRARY: LibraryExercise[] = [
	{
		_id: "a1",
		name: "Barbell Bench Press",
		muscleGroups: ["Chest"],
		isSystem: true,
	},
	{ _id: "a2", name: "Push-Up", muscleGroups: ["Chest"], isSystem: true },
	{ _id: "a3", name: "Plank", muscleGroups: ["Core"], isSystem: true },
	{
		_id: "a4",
		name: "Jumping Jacks",
		muscleGroups: ["FullBody"],
		isSystem: true,
	},
	{
		_id: "a5",
		name: "Hamstring Stretch",
		muscleGroups: ["Legs"],
		isSystem: true,
	},
	{
		_id: "a6",
		name: "Bodyweight Squat",
		muscleGroups: ["Legs"],
		isSystem: true,
	},
	{ _id: "c1", name: "Push-Up", muscleGroups: ["Chest"], isSystem: false },
];

type Cell = string | number | boolean | null;

const PLAN_OK: Cell[][] = [
	["Field", "Value"],
	["Plan Name*", "Beginner Push"],
	["Difficulty*", "beginner"],
	["Duration (weeks)*", 2],
	["Goal*", "Weight Loss"],
	["Split Type", "push pull legs"],
];

const HEADER: Cell[] = [
	"Day*",
	"Day Name*",
	"Rest Day",
	"Section",
	"Exercise*",
	"Sets*",
	"Reps*",
	"Weight (kg)",
	"Rest (sec)",
	"Duration (sec)",
	"Notes",
];

const book = (plan: Cell[][], workout: Cell[][]): Buffer => {
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.aoa_to_sheet(plan),
		"Plan Details",
	);
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workout), "Workout");
	return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

function runUnitTests() {
	console.log(
		"\n🔎 A well-formed sheet becomes a valid POST /workout-plans body",
	);
	{
		const { plan, errors, warnings } = parseWorkoutPlanWorkbook(
			book(PLAN_OK, [
				HEADER,
				// Rows deliberately out of section order: stretching first.
				[
					1,
					"Push",
					null,
					"stretch",
					"hamstring stretch",
					1,
					null,
					null,
					0,
					60,
					null,
				],
				[
					1,
					null,
					null,
					null,
					"barbell bench press",
					4,
					8,
					42.5,
					90,
					null,
					"Pause at chest",
				],
				[
					1,
					null,
					null,
					"Warm up",
					"Jumping Jacks",
					2,
					null,
					null,
					null,
					30,
					null,
				],
				[1, null, null, "Workout", "Plank", 3, null, null, 45, 30, null],
				[null, null, null, null, null, null, null, null, null, null, null],
				[2, "Rest", "Yes", null, null, null, null, null, null, null, null],
				[
					3,
					"Legs",
					"no",
					"Workout",
					"Bodyweight Squat",
					3,
					15,
					null,
					null,
					null,
					null,
				],
			]),
			LIBRARY,
		);
		assert(errors.length === 0, `no errors (got ${JSON.stringify(errors)})`);
		assert(plan !== null, "a plan is returned");
		assert(
			plan!.difficulty === "Beginner",
			"difficulty matched case-insensitively",
		);
		assert(plan!.goal === "WeightLoss", '"Weight Loss" maps to WeightLoss');
		assert(plan!.splitType === "PushPullLegs", "split type with spaces maps");
		assert(plan!.isTemplate === true, "Save as Template defaults to Yes");
		assert(plan!.status === "Active", "status defaults to Active");
		assert(plan!.days.length === 3, "three days");

		const d1 = plan!.days[0]!;
		assert(d1.name === "Push", "day name taken from the first row of the day");
		assert(
			d1.exercises.map((e) => e.section).join(",") ===
				"warmup,workout,workout,stretching",
			"exercises are grouped warmup → workout → stretching",
		);
		assert(
			d1.exercises.map((e) => e.orderIndex).join(",") === "0,1,2,3",
			"orderIndex is sequential within the day",
		);
		const bench = d1.exercises[1]!;
		assert(
			bench.exerciseId === "a1" && bench.targetWeightKg === 42.5,
			"bench resolved with weight",
		);
		assert(
			bench.restSeconds === 90 && bench.notes === "Pause at chest",
			"rest and notes kept",
		);
		const plank = d1.exercises[2]!;
		assert(
			plank.targetReps === 1 && plank.durationSeconds === 30,
			"timed exercise gets reps 1 + duration",
		);
		assert(d1.exercises[0]!.restSeconds === 60, "blank rest defaults to 60");

		assert(
			plan!.days[1]!.isRestDay && plan!.days[1]!.exercises.length === 0,
			"day 2 is a rest day",
		);
		assert(
			warnings.length === 0,
			`no warnings (got ${JSON.stringify(warnings)})`,
		);

		const body = createPlanBodySchema.safeParse({
			...plan,
			days: plan!.days.map((d) => ({
				...d,
				exercises: d.exercises.map(({ exerciseName: _n, ...e }) => e),
			})),
		});
		assert(body.success, "the parsed plan passes createPlanBodySchema");
	}

	console.log(
		"\n🔎 Mistakes are reported per row, with the column, instead of throwing",
	);
	{
		const { errors } = parseWorkoutPlanWorkbook(
			book(
				[
					["Plan Name*", ""],
					["Difficulty*", "Expert"],
					["Duration (weeks)*", "four"],
					["Goal*", "Strength"],
				],
				[
					HEADER,
					[1, "Push", null, null, "Bench Pres", 3, 10, null, null, null, null],
					[1, null, null, "Cardio", "Plank", 3, 10, null, null, null, null],
					[1, null, null, null, "Push-Up", 0, 10, null, null, null, null],
					[1, null, null, null, "Plank", 3, null, null, null, null, null],
					[
						3,
						"Legs",
						null,
						null,
						"Bodyweight Squat",
						3,
						12,
						-5,
						null,
						null,
						null,
					],
				],
			),
			LIBRARY,
		);
		const has = (needle: string) =>
			errors.some((e) => e.message.includes(needle));
		assert(has("Plan Name: is required"), "missing plan name");
		assert(has('"Expert" is not one of'), "bad difficulty");
		assert(has("Duration (weeks): must be a number"), "non-numeric duration");
		assert(
			has("Did you mean: Barbell Bench Press"),
			"unknown exercise gets a suggestion",
		);
		const bench = errors.find((e) => e.message.includes("Bench Pres"));
		assert(
			bench?.row === 2 && bench?.column === "E",
			"error carries Excel row 2, column E",
		);
		assert(
			has('"Cardio" must be Warmup, Workout or Stretching'),
			"bad section",
		);
		assert(
			has("Sets: must be a whole number from 1 to 50"),
			"sets out of range",
		);
		assert(
			has("Reps: is required unless Duration"),
			"reps needed when not timed",
		);
		assert(
			has("Weight (kg): must be a number from 0 to 999.99"),
			"negative weight",
		);
		assert(has("Missing: 2"), "gap in day numbers");
	}

	console.log("\n🔎 Structural problems");
	{
		const noSheets = parseWorkoutPlanWorkbook(
			Buffer.from("not a spreadsheet"),
			LIBRARY,
		);
		assert(
			noSheets.plan === null && noSheets.errors.length > 0,
			"garbage input is an error, not a throw",
		);

		const noHeader = parseWorkoutPlanWorkbook(
			book(PLAN_OK, [
				["foo", "bar"],
				[1, 2],
			]),
			LIBRARY,
		);
		assert(
			noHeader.errors.some((e) => e.message.includes("Header row not found")),
			"missing header",
		);

		const restWithExercise = parseWorkoutPlanWorkbook(
			book(PLAN_OK, [
				HEADER,
				[1, "Push", null, null, "Plank", 3, null, null, null, 30, null],
				[2, "Rest", "Yes", null, "Plank", null, null, null, null, null, null],
				[3, null, null, null, "Plank", 3, null, null, null, 30, null],
			]),
			LIBRARY,
		);
		const msgs = restWithExercise.errors.map((e) => e.message).join(" | ");
		assert(
			msgs.includes("must be blank on a rest day row"),
			"rest row with an exercise",
		);
		assert(msgs.includes("Day 3 needs a Day Name"), "unnamed training day");
		assert(
			restWithExercise.plan?.days[1]?.name === "Rest",
			"named rest day kept",
		);

		const onlyRest = parseWorkoutPlanWorkbook(
			book(PLAN_OK, [
				HEADER,
				[1, null, "Yes", null, null, null, null, null, null, null, null],
			]),
			LIBRARY,
		);
		assert(
			onlyRest.errors.some((e) => e.message.includes("only rest days")),
			"rest-only plan rejected",
		);
		assert(
			onlyRest.plan?.days[0]?.name === "Rest",
			"unnamed rest day defaults to Rest",
		);
	}

	console.log("\n🔎 Duplicate names prefer the system exercise and warn");
	{
		const { plan, errors, warnings } = parseWorkoutPlanWorkbook(
			book(PLAN_OK, [
				HEADER,
				[1, "Push", null, null, "PUSH UP", 3, 10, null, null, null, null],
			]),
			LIBRARY,
		);
		assert(errors.length === 0, "no errors");
		assert(
			plan?.days[0]?.exercises[0]?.exerciseId === "a2",
			'"PUSH UP" resolves to the system Push-Up',
		);
		assert(
			warnings.some((w) => w.message.includes("More than one exercise")),
			"ambiguity warned",
		);
	}

	console.log("\n🔎 The downloaded template round-trips");
	{
		const template = buildWorkoutPlanTemplate(LIBRARY);
		const wb = XLSX.read(template, { type: "buffer" });
		assert(
			[
				"Instructions",
				"Plan Details",
				"Workout",
				"Example",
				"Exercise Library",
				"Allowed Values",
			].every((n) => wb.SheetNames.includes(n)),
			"all six sheets present",
		);
		const lib = XLSX.utils.sheet_to_json<Record<string, string>>(
			wb.Sheets["Exercise Library"]!,
		);
		assert(
			lib.length === LIBRARY.length &&
				lib[0]?.Exercise === "Barbell Bench Press",
			"library sorted by name",
		);

		// Untouched template: rejected with "required" errors, not a crash.
		const blank = parseWorkoutPlanWorkbook(template, LIBRARY);
		assert(
			blank.errors.some((e) => e.message.includes("Plan Name: is required")),
			"blank template asks for a name",
		);
		assert(
			blank.errors.some((e) => e.message.includes("No workout rows")),
			"blank template asks for rows",
		);

		// Fill it the way a trainer would and it imports.
		const plan = wb.Sheets["Plan Details"]!;
		XLSX.utils.sheet_add_aoa(
			plan,
			[["Upper Body"], [""], ["Intermediate"], [6], ["Strength"]],
			{ origin: "B2" },
		);
		XLSX.utils.sheet_add_aoa(
			wb.Sheets.Workout!,
			[
				[
					1,
					"Upper",
					null,
					"Workout",
					"Barbell Bench Press",
					5,
					5,
					80,
					120,
					null,
					null,
				],
				[2, "Rest", "Yes"],
			],
			{ origin: "A2" },
		);
		const filled = parseWorkoutPlanWorkbook(
			XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
			LIBRARY,
		);
		assert(
			filled.errors.length === 0,
			`filled template imports (got ${JSON.stringify(filled.errors)})`,
		);
		assert(
			filled.plan?.name === "Upper Body" && filled.plan.duration === 6,
			"plan details read from column B",
		);
	}

	console.log("\n🎉 Workout Plan Excel Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Workout plan Excel test failed:", err);
	process.exit(1);
}
