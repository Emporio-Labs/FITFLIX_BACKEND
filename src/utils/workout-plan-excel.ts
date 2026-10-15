/**
 * Excel (.xlsx) import format for workout plans.
 *
 * Trainers/admins download a template (`buildWorkoutPlanTemplate`), fill it in,
 * and upload it back (`parseWorkoutPlanWorkbook`). The parser turns the sheet
 * into the exact `POST /workout-plans` body, so the import goes through the
 * same `createPlanBodySchema` as the plan builder — nothing here writes to the
 * database.
 *
 * Workbook layout (sheet names are matched case-insensitively):
 *
 *   "Plan Details" — one field per row: label in column A, value in column B.
 *   "Workout"      — one row per exercise. Columns are found by header text,
 *                    so they may be reordered; the header row may sit below a
 *                    title row.
 *
 * Any other sheet (Instructions, Example, Exercise Library, Allowed Values) is
 * reference material and ignored on upload.
 *
 * Plan days are scheduled one calendar day each, in order (see
 * `initializeSchedule`), so Day numbers must run 1..N with no gaps and rest
 * days must be listed explicitly.
 */
import XLSX from "xlsx";
import {
	ExerciseDifficulty,
	ExerciseSection,
	PlanGoal,
	PlanStatus,
	SplitType,
} from "../models/Enums";
import {
	type CellStyle,
	type DataValidation,
	enhanceXlsx,
} from "./xlsx-enhance";

export const PLAN_SHEET = "Plan Details";
export const WORKOUT_SHEET = "Workout";
const EXAMPLE_SHEET = "Example";
const LIBRARY_SHEET = "Exercise Library";
const VALUES_SHEET = "Allowed Values";
const INSTRUCTIONS_SHEET = "Instructions";

/** Hard ceiling so a runaway sheet can't produce a multi-megabyte plan. */
export const MAX_WORKOUT_ROWS = 2000;
export const MAX_PLAN_DAYS = 366;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LibraryExercise {
	_id: string;
	name: string;
	muscleGroups?: string[];
	equipment?: string;
	difficulty?: string;
	sectionTypes?: string[];
	isSystem?: boolean;
}

export interface ImportIssue {
	sheet: string;
	/** 1-based Excel row number; omitted for workbook-level problems. */
	row?: number;
	column?: string;
	message: string;
}

export interface ParsedPlanExercise {
	exerciseId: string;
	exerciseName: string;
	orderIndex: number;
	targetSets: number;
	targetReps: number;
	targetWeightKg: number;
	restSeconds: number;
	section: ExerciseSection;
	durationSeconds: number | null;
	notes: string | null;
}

export interface ParsedPlanDay {
	dayNumber: number;
	name: string;
	isRestDay: boolean;
	exercises: ParsedPlanExercise[];
}

export interface ParsedPlan {
	name: string;
	description: string;
	difficulty: string;
	duration: number;
	goal: string;
	splitType: string;
	status: string;
	isTemplate: boolean;
	templateCategory: string | null;
	days: ParsedPlanDay[];
}

export interface ParseResult {
	/** Null when the workbook is too broken to describe a plan at all. */
	plan: ParsedPlan | null;
	errors: ImportIssue[];
	warnings: ImportIssue[];
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

/** "Weight (kg)*" → "weightkg"; used for headers, labels and enum values. */
const key = (value: unknown): string =>
	String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");

/** Exercise names: case/punctuation-insensitive but word boundaries kept. */
export const normalizeExerciseName = (value: unknown): string =>
	String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

const text = (value: unknown): string => {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return value.toISOString();
	return String(value).trim();
};

const isBlank = (value: unknown): boolean => text(value) === "";

type NumberResult = { ok: true; value: number | null } | { ok: false };

const toNumber = (value: unknown): NumberResult => {
	if (isBlank(value)) return { ok: true, value: null };
	const n = typeof value === "number" ? value : Number(text(value));
	return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
};

type BoolResult = { ok: true; value: boolean | null } | { ok: false };

const toBool = (value: unknown): BoolResult => {
	if (typeof value === "boolean") return { ok: true, value };
	if (isBlank(value)) return { ok: true, value: null };
	const k = key(value);
	if (["yes", "y", "true", "1"].includes(k)) return { ok: true, value: true };
	if (["no", "n", "false", "0"].includes(k)) return { ok: true, value: false };
	return { ok: false };
};

/** Lookup that accepts "Weight Loss", "weight_loss", "WEIGHTLOSS" … */
const enumLookup = <T extends string>(
	values: readonly T[],
	aliases: Record<string, T> = {},
) => {
	const map = new Map<string, T>();
	for (const v of values) map.set(key(v), v);
	for (const [alias, v] of Object.entries(aliases)) map.set(key(alias), v);
	return (value: unknown): T | undefined => map.get(key(value));
};

const difficultyOf = enumLookup(Object.values(ExerciseDifficulty));
const goalOf = enumLookup(Object.values(PlanGoal));
const splitOf = enumLookup(Object.values(SplitType), {
	PPL: SplitType.PushPullLegs,
});
const statusOf = enumLookup([PlanStatus.Draft, PlanStatus.Active]);
const sectionOf = enumLookup(Object.values(ExerciseSection), {
	"warm up": ExerciseSection.Warmup,
	main: ExerciseSection.Workout,
	stretch: ExerciseSection.Stretching,
	"cool down": ExerciseSection.Stretching,
	cooldown: ExerciseSection.Stretching,
});

const SECTION_ORDER: Record<ExerciseSection, number> = {
	[ExerciseSection.Warmup]: 0,
	[ExerciseSection.Workout]: 1,
	[ExerciseSection.Stretching]: 2,
};

/** Human labels for the template; parsing goes through `sectionOf`. */
const SECTION_LABELS = ["Warmup", "Workout", "Stretching"];

// ─── Column definitions ───────────────────────────────────────────────────────

type WorkoutColumn =
	| "day"
	| "dayName"
	| "restDay"
	| "section"
	| "exercise"
	| "sets"
	| "reps"
	| "weight"
	| "rest"
	| "duration"
	| "notes";

interface ColumnSpec {
	id: WorkoutColumn;
	header: string;
	aliases: string[];
	required: boolean;
	help: string;
}

export const WORKOUT_COLUMNS: ColumnSpec[] = [
	{
		id: "day",
		header: "Day*",
		aliases: ["day", "daynumber", "dayno"],
		required: true,
		help: "Day number in the plan: 1, 2, 3 … with no gaps. Repeat it on every row of that day.",
	},
	{
		id: "dayName",
		header: "Day Name*",
		aliases: ["dayname", "dayfocus", "daytitle"],
		required: false,
		help: 'Title shown to the member, e.g. "Push Day". Needed on at least one row of each day.',
	},
	{
		id: "restDay",
		header: "Rest Day",
		aliases: ["restday", "isrestday"],
		required: false,
		help: "Yes for a rest day (one row, no exercise). Blank = No.",
	},
	{
		id: "section",
		header: "Section",
		aliases: ["section", "block"],
		required: false,
		help: "Warmup, Workout or Stretching. Blank = Workout.",
	},
	{
		id: "exercise",
		header: "Exercise*",
		aliases: ["exercise", "exercisename"],
		required: true,
		help: 'Pick from the drop-down (the "Exercise Library" sheet). Typed names must match a library name; capitals and punctuation are ignored.',
	},
	{
		id: "sets",
		header: "Sets*",
		aliases: ["sets", "targetsets"],
		required: true,
		help: "Whole number, 1–50.",
	},
	{
		id: "reps",
		header: "Reps*",
		aliases: ["reps", "targetreps"],
		required: false,
		help: "Whole number, 1–100. May be blank only when Duration (sec) is filled (timed exercise).",
	},
	{
		id: "weight",
		header: "Weight (kg)",
		aliases: ["weightkg", "weight", "targetweightkg"],
		required: false,
		help: "0–999.99. Blank = 0 (bodyweight).",
	},
	{
		id: "rest",
		header: "Rest (sec)",
		aliases: ["restsec", "restseconds", "restsecs"],
		required: false,
		help: "Rest between sets, 0–600 seconds. Blank = 60.",
	},
	{
		id: "duration",
		header: "Duration (sec)",
		aliases: ["durationsec", "durationseconds", "durationsecs", "timesec"],
		required: false,
		help: "Only for timed exercises (plank, cardio). Seconds per set.",
	},
	{
		id: "notes",
		header: "Notes",
		aliases: ["notes", "note", "coachnotes"],
		required: false,
		help: "Optional cue for the member, max 1000 characters.",
	},
];

export type PlanField =
	| "name"
	| "description"
	| "difficulty"
	| "duration"
	| "goal"
	| "splitType"
	| "isTemplate"
	| "templateCategory"
	| "status";

interface PlanFieldSpec {
	id: PlanField;
	label: string;
	aliases: string[];
	help: string;
	example: string | number;
}

export const PLAN_FIELDS: PlanFieldSpec[] = [
	{
		id: "name",
		label: "Plan Name*",
		aliases: ["planname", "name"],
		help: "Up to 200 characters.",
		example: "4-Week Beginner Fat Loss",
	},
	{
		id: "description",
		label: "Description",
		aliases: ["description"],
		help: "Optional, up to 2000 characters.",
		example: "Full-body circuits three times a week with active recovery days.",
	},
	{
		id: "difficulty",
		label: "Difficulty*",
		aliases: ["difficulty", "level"],
		help: Object.values(ExerciseDifficulty).join(", "),
		example: ExerciseDifficulty.Beginner,
	},
	{
		id: "duration",
		label: "Duration (weeks)*",
		aliases: ["durationweeks", "duration", "weeks"],
		help: "Whole number, 1–52. A label only — the schedule length is the number of Days.",
		example: 4,
	},
	{
		id: "goal",
		label: "Goal*",
		aliases: ["goal"],
		help: Object.values(PlanGoal).join(", "),
		example: PlanGoal.WeightLoss,
	},
	{
		id: "splitType",
		label: "Split Type",
		aliases: ["splittype", "split"],
		help: `${Object.values(SplitType).join(", ")}. Blank = Custom.`,
		example: SplitType.FullBody,
	},
	{
		id: "isTemplate",
		label: "Save as Template",
		aliases: ["saveastemplate", "template", "istemplate"],
		help: "Yes or No. Blank = Yes (appears under Workout Templates).",
		example: "Yes",
	},
	{
		id: "templateCategory",
		label: "Template Category",
		aliases: ["templatecategory", "category"],
		help: "Optional free text, e.g. Fat Loss, Strength, Beginner.",
		example: "Fat Loss",
	},
	{
		id: "status",
		label: "Status",
		aliases: ["status"],
		help: "Draft or Active. Blank = Active.",
		example: PlanStatus.Active,
	},
];

// ─── Template ─────────────────────────────────────────────────────────────────

export type Row = (string | number | null)[];

// Names are from the seeded system library (scripts/seed-exercises.ts).
const EXAMPLE_ROWS: Row[] = [
	[
		1,
		"Full Body A",
		null,
		"Warmup",
		"Jumping Jacks",
		2,
		null,
		null,
		30,
		45,
		null,
	],
	[
		1,
		null,
		null,
		"Workout",
		"Bodyweight Squats",
		3,
		15,
		0,
		60,
		null,
		"Knees track over toes",
	],
	[
		1,
		null,
		null,
		"Workout",
		"Push Ups",
		3,
		10,
		0,
		60,
		null,
		"Drop to knees if needed",
	],
	[1, null, null, "Workout", "Plank Hold", 3, null, null, 45, 30, null],
	[
		1,
		null,
		null,
		"Stretching",
		"Hamstring Stretch",
		1,
		null,
		null,
		0,
		60,
		null,
	],
	[2, "Rest", "Yes", null, null, null, null, null, null, null, null],
	[
		3,
		"Full Body B",
		null,
		"Workout",
		"Single Arm Dumbbell Row",
		3,
		12,
		10,
		60,
		null,
		null,
	],
	[
		3,
		null,
		null,
		"Workout",
		"Bodyweight Lunges",
		3,
		10,
		0,
		60,
		null,
		"10 reps each leg",
	],
];

const sheetFromRows = (rows: Row[], widths: number[]): XLSX.WorkSheet => {
	const ws = XLSX.utils.aoa_to_sheet(rows);
	ws["!cols"] = widths.map((wch) => ({ wch }));
	return ws;
};

const workoutHeader = (): Row => WORKOUT_COLUMNS.map((c) => c.header);
const WORKOUT_WIDTHS = [6, 18, 9, 12, 32, 6, 6, 11, 10, 14, 36];

/** Values written into a template: used for sample files and plan export. */
export interface TemplatePrefill {
	details: Partial<Record<PlanField, string | number>>;
	/** Workout rows in WORKOUT_COLUMNS order. */
	rows: Row[];
}

const SECTION_LABEL_BY_VALUE: Record<string, string> = {
	[ExerciseSection.Warmup]: "Warmup",
	[ExerciseSection.Workout]: "Workout",
	[ExerciseSection.Stretching]: "Stretching",
};

export interface ExportablePlan {
	name: string;
	description?: string | null;
	difficulty: string;
	duration: number;
	goal: string;
	splitType?: string | null;
	status?: string | null;
	isTemplate?: boolean | null;
	templateCategory?: string | null;
	days: Array<{
		dayNumber: number;
		name: string;
		isRestDay?: boolean | null;
		exercises: Array<{
			exerciseName: string;
			orderIndex: number;
			section?: string | null;
			targetSets: number;
			targetReps: number;
			targetWeightKg?: number | null;
			restSeconds?: number | null;
			durationSeconds?: number | null;
			notes?: string | null;
		}>;
	}>;
}

/**
 * Turn a stored plan back into sheet values, so an exported file re-imports
 * to the same plan. Timed exercises (duration set, reps 1) export blank reps.
 * Paused/Completed/Archived statuses export as Active — the import only
 * accepts Draft or Active.
 */
export function planToPrefill(plan: ExportablePlan): TemplatePrefill {
	const rows: Row[] = [];
	for (const day of [...plan.days].sort((a, b) => a.dayNumber - b.dayNumber)) {
		if (day.isRestDay) {
			rows.push([day.dayNumber, day.name, "Yes"]);
			continue;
		}
		const exercises = [...day.exercises].sort(
			(a, b) => a.orderIndex - b.orderIndex,
		);
		if (exercises.length === 0) {
			// The builder allows an empty training day; it can't be expressed
			// as a row without an exercise, so it exports as a named rest day.
			rows.push([day.dayNumber, day.name, "Yes"]);
			continue;
		}
		exercises.forEach((ex, i) => {
			const timed = Boolean(ex.durationSeconds) && ex.targetReps === 1;
			rows.push([
				day.dayNumber,
				i === 0 ? day.name : null,
				null,
				SECTION_LABEL_BY_VALUE[ex.section ?? ExerciseSection.Workout] ??
					"Workout",
				ex.exerciseName,
				ex.targetSets,
				timed ? null : ex.targetReps,
				ex.targetWeightKg ? ex.targetWeightKg : null,
				ex.restSeconds ?? 60,
				ex.durationSeconds ? ex.durationSeconds : null,
				ex.notes ? ex.notes : null,
			]);
		});
	}
	return {
		details: {
			name: plan.name,
			description: plan.description ?? "",
			difficulty: plan.difficulty,
			duration: plan.duration,
			goal: plan.goal,
			splitType: plan.splitType ?? SplitType.Custom,
			isTemplate: plan.isTemplate === false ? "No" : "Yes",
			templateCategory: plan.templateCategory ?? "",
			status:
				plan.status === PlanStatus.Draft ? PlanStatus.Draft : PlanStatus.Active,
		},
		rows,
	};
}

/**
 * Build the downloadable template. `exercises` is the requester's visible
 * exercise library (system + their own) and is written into the workbook so a
 * trainer can copy exact names.
 */
export function buildWorkoutPlanTemplate(
	exercises: LibraryExercise[],
	prefill?: TemplatePrefill,
): Buffer {
	const wb = XLSX.utils.book_new();

	const instructions: Row[] = [
		["How to create a workout plan in Excel"],
		[],
		[
			"1.",
			`Fill in the "${PLAN_SHEET}" sheet (column B). Yellow fields (marked *) are required; most cells have a drop-down.`,
		],
		[
			"2.",
			`Fill in the "${WORKOUT_SHEET}" sheet — one row per exercise. Keep the header row as it is. Yellow columns are required.`,
		],
		[
			"3.",
			"Number days 1, 2, 3 … with no gaps. Each Day is one calendar day for the member, in order.",
		],
		[
			"4.",
			'For a rest day add a single row: the Day number, a Day Name (e.g. "Rest") and Rest Day = Yes.',
		],
		[
			"5.",
			`Pick the Exercise from the cell's drop-down (the list is the "${LIBRARY_SHEET}" sheet — filter it by muscle group or equipment there). Pasted names that are not in the library are rejected on upload with suggestions.`,
		],
		[
			"6.",
			"Within a day, exercises are shown in row order, grouped Warmup → Workout → Stretching.",
		],
		[
			"7.",
			"Upload the file in FrontDesk → Workout Templates → Import from Excel. You get a preview before anything is saved.",
		],
		[],
		[
			`See the "${EXAMPLE_SHEET}" sheet for a filled-in sample. Only "${PLAN_SHEET}" and "${WORKOUT_SHEET}" are read on upload.`,
		],
		[],
		["Workout column", "Rules"],
		...WORKOUT_COLUMNS.map((c) => [c.header, c.help]),
	];
	XLSX.utils.book_append_sheet(
		wb,
		sheetFromRows(instructions, [18, 110]),
		INSTRUCTIONS_SHEET,
	);

	const planRows: Row[] = [
		["Field", "Value", "Allowed values / rules"],
		...PLAN_FIELDS.map((f) => {
			const value = prefill?.details[f.id];
			return [
				f.label,
				value === undefined || value === "" ? null : value,
				f.help,
			];
		}),
	];
	XLSX.utils.book_append_sheet(
		wb,
		sheetFromRows(planRows, [20, 40, 90]),
		PLAN_SHEET,
	);

	XLSX.utils.book_append_sheet(
		wb,
		sheetFromRows([workoutHeader(), ...(prefill?.rows ?? [])], WORKOUT_WIDTHS),
		WORKOUT_SHEET,
	);

	const exampleRows: Row[] = [
		["Sample only — this sheet is ignored on upload."],
		...PLAN_FIELDS.map((f) => [f.label, f.example]),
		[],
		workoutHeader(),
		...EXAMPLE_ROWS,
	];
	XLSX.utils.book_append_sheet(
		wb,
		sheetFromRows(
			exampleRows,
			WORKOUT_WIDTHS.map((w, i) => (i === 0 ? 20 : w)),
		),
		EXAMPLE_SHEET,
	);

	const libraryRows: Row[] = [
		["Exercise", "Muscle Groups", "Equipment", "Difficulty", "Sections"],
		...[...exercises]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((e) => [
				e.name,
				(e.muscleGroups ?? []).join(", "),
				e.equipment ?? "",
				e.difficulty ?? "",
				(e.sectionTypes ?? []).join(", "),
			]),
	];
	const libraryWs = sheetFromRows(libraryRows, [36, 24, 20, 14, 26]);
	libraryWs["!autofilter"] = { ref: `A1:E${libraryRows.length}` };
	XLSX.utils.book_append_sheet(wb, libraryWs, LIBRARY_SHEET);

	const lists: string[][] = [
		Object.values(ExerciseDifficulty),
		Object.values(PlanGoal),
		Object.values(SplitType),
		SECTION_LABELS,
		[PlanStatus.Draft, PlanStatus.Active],
		["Yes", "No"],
	];
	const longest = Math.max(...lists.map((l) => l.length));
	const valueRows: Row[] = [
		["Difficulty", "Goal", "Split Type", "Section", "Status", "Yes / No"],
		...Array.from({ length: longest }, (_, i) =>
			lists.map((l) => l[i] ?? null),
		),
	];
	XLSX.utils.book_append_sheet(
		wb,
		sheetFromRows(valueRows, [14, 16, 16, 12, 10, 10]),
		VALUES_SHEET,
	);

	const raw = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

	// Sheet positions follow the append order above.
	return enhanceXlsx(raw, {
		1: {
			styles: {
				A1: "title",
				[`A${instructions.length - WORKOUT_COLUMNS.length}`]: "header",
				[`B${instructions.length - WORKOUT_COLUMNS.length}`]: "header",
			},
		},
		2: {
			freezeRows: 1,
			styles: {
				A1: "header",
				B1: "header",
				C1: "header",
				...Object.fromEntries(
					PLAN_FIELDS.map((f, i): [string, CellStyle] => [
						`A${i + 2}`,
						f.label.endsWith("*") ? "required" : "header",
					]),
				),
			},
			validations: planValidations(lists),
		},
		3: {
			freezeRows: 1,
			styles: headerStyles(),
			validations: workoutValidations(lists, exercises.length),
		},
		4: {
			styles: {
				A1: "title",
				...headerStyles(PLAN_FIELDS.length + 3),
			},
		},
		5: {
			freezeRows: 1,
			styles: {
				A1: "header",
				B1: "header",
				C1: "header",
				D1: "header",
				E1: "header",
			},
		},
		6: {
			freezeRows: 1,
			styles: {
				A1: "header",
				B1: "header",
				C1: "header",
				D1: "header",
				E1: "header",
				F1: "header",
			},
		},
	});
}

// ─── Template drop-downs and cell rules ───────────────────────────────────────

/** Order of the columns on the "Allowed Values" sheet. */
const VALUE_COLUMN = {
	difficulty: 0,
	goal: 1,
	split: 2,
	section: 3,
	status: 4,
	yesNo: 5,
} as const;

/** Rows covered by the Workout sheet's validations (header + max rows). */
const LAST_WORKOUT_ROW = MAX_WORKOUT_ROWS + 1;

const listSource = (lists: string[][], column: number): string => {
	const col = XLSX.utils.encode_col(column);
	return `'${VALUES_SHEET}'!$${col}$2:$${col}$${(lists[column]?.length ?? 0) + 1}`;
};

const pickFrom = (
	sqref: string,
	formula1: string,
	title: string,
	prompt: string,
): DataValidation => ({
	sqref,
	type: "list",
	formula1,
	promptTitle: title,
	prompt,
	errorTitle: `Invalid ${title}`,
	error: `Choose a value from the drop-down. ${prompt}`,
});

const numberRule = (
	sqref: string,
	type: "whole" | "decimal",
	min: number,
	max: number,
	title: string,
	prompt: string,
): DataValidation => ({
	sqref,
	type,
	operator: "between",
	formula1: String(min),
	formula2: String(max),
	promptTitle: title,
	prompt,
	errorTitle: `Invalid ${title}`,
	error: prompt,
});

const lengthRule = (
	sqref: string,
	max: number,
	title: string,
	prompt: string,
): DataValidation => ({
	sqref,
	type: "textLength",
	operator: "lessThanOrEqual",
	formula1: String(max),
	promptTitle: title,
	prompt,
	errorTitle: `${title} too long`,
	error: `Keep it to ${max} characters or fewer.`,
});

function planValidations(lists: string[][]): DataValidation[] {
	const cell = (id: PlanField) =>
		`B${PLAN_FIELDS.findIndex((f) => f.id === id) + 2}`;
	const help = (id: PlanField) =>
		PLAN_FIELDS.find((f) => f.id === id)?.help ?? "";
	return [
		lengthRule(
			cell("name"),
			200,
			"Plan Name",
			"Required. Up to 200 characters.",
		),
		lengthRule(cell("description"), 2000, "Description", help("description")),
		pickFrom(
			cell("difficulty"),
			listSource(lists, VALUE_COLUMN.difficulty),
			"Difficulty",
			"Required.",
		),
		numberRule(
			cell("duration"),
			"whole",
			1,
			52,
			"Duration (weeks)",
			"Required. Whole number 1–52. A label only — the schedule length is the number of Days.",
		),
		pickFrom(
			cell("goal"),
			listSource(lists, VALUE_COLUMN.goal),
			"Goal",
			"Required.",
		),
		pickFrom(
			cell("splitType"),
			listSource(lists, VALUE_COLUMN.split),
			"Split Type",
			"Blank = Custom.",
		),
		pickFrom(
			cell("isTemplate"),
			listSource(lists, VALUE_COLUMN.yesNo),
			"Save as Template",
			"Blank = Yes (listed under Workout Templates).",
		),
		lengthRule(
			cell("templateCategory"),
			100,
			"Template Category",
			help("templateCategory"),
		),
		pickFrom(
			cell("status"),
			listSource(lists, VALUE_COLUMN.status),
			"Status",
			"Blank = Active.",
		),
	];
}

function workoutValidations(
	lists: string[][],
	libraryCount: number,
): DataValidation[] {
	const range = (id: WorkoutColumn) => {
		const col = XLSX.utils.encode_col(
			WORKOUT_COLUMNS.findIndex((c) => c.id === id),
		);
		return `${col}2:${col}${LAST_WORKOUT_ROW}`;
	};
	const help = (id: WorkoutColumn) =>
		WORKOUT_COLUMNS.find((c) => c.id === id)?.help ?? "";

	const rules: DataValidation[] = [
		numberRule(range("day"), "whole", 1, MAX_PLAN_DAYS, "Day", help("day")),
		lengthRule(range("dayName"), 100, "Day Name", help("dayName")),
		pickFrom(
			range("restDay"),
			listSource(lists, VALUE_COLUMN.yesNo),
			"Rest Day",
			help("restDay"),
		),
		pickFrom(
			range("section"),
			listSource(lists, VALUE_COLUMN.section),
			"Section",
			help("section"),
		),
		numberRule(range("sets"), "whole", 1, 50, "Sets", help("sets")),
		numberRule(range("reps"), "whole", 1, 100, "Reps", help("reps")),
		numberRule(
			range("weight"),
			"decimal",
			0,
			999.99,
			"Weight (kg)",
			help("weight"),
		),
		numberRule(range("rest"), "whole", 0, 600, "Rest (sec)", help("rest")),
		numberRule(
			range("duration"),
			"whole",
			1,
			86400,
			"Duration (sec)",
			help("duration"),
		),
		lengthRule(range("notes"), 1000, "Notes", help("notes")),
	];
	if (libraryCount > 0) {
		rules.push(
			pickFrom(
				range("exercise"),
				`'${LIBRARY_SHEET}'!$A$2:$A$${libraryCount + 1}`,
				"Exercise",
				"Pick from the list (the Exercise Library sheet). Missing one? Add it in FrontDesk and download a fresh template.",
			),
		);
	}
	return rules;
}

/** Workout header cells at `row`: yellow when required, grey otherwise. */
const headerStyles = (row = 1): Record<string, CellStyle> =>
	Object.fromEntries(
		WORKOUT_COLUMNS.map((c, i): [string, CellStyle] => [
			`${XLSX.utils.encode_col(i)}${row}`,
			c.header.endsWith("*") ? "required" : "header",
		]),
	);

// ─── Exercise matching ────────────────────────────────────────────────────────

export interface ExerciseIndex {
	resolve: (
		name: string,
	) =>
		| { ok: true; exercise: LibraryExercise; ambiguous: boolean }
		| { ok: false; suggestions: string[] };
}

/**
 * Name → exercise lookup. When the library holds the same name twice, a
 * system exercise wins over a custom one and the caller is told so it can
 * warn.
 */
export function buildExerciseIndex(
	exercises: LibraryExercise[],
): ExerciseIndex {
	const byName = new Map<string, LibraryExercise[]>();
	for (const e of exercises) {
		const k = normalizeExerciseName(e.name);
		if (!k) continue;
		const bucket = byName.get(k) ?? [];
		bucket.push(e);
		byName.set(k, bucket);
	}

	const suggest = (needle: string): string[] => {
		const words = needle.split(" ").filter((w) => w.length > 2);
		const scored: { name: string; score: number }[] = [];
		for (const [k, bucket] of byName) {
			let score = 0;
			if (k.includes(needle) || needle.includes(k)) score += 3;
			for (const w of words) if (k.includes(w)) score += 1;
			const first = bucket[0];
			if (score > 0 && first) scored.push({ name: first.name, score });
		}
		return scored
			.sort((a, b) => b.score - a.score || a.name.length - b.name.length)
			.slice(0, 3)
			.map((s) => s.name);
	};

	return {
		resolve(name) {
			const k = normalizeExerciseName(name);
			const bucket = byName.get(k) ?? [];
			const preferred = bucket.find((e) => e.isSystem) ?? bucket[0];
			if (!preferred) return { ok: false, suggestions: suggest(k) };
			return { ok: true, exercise: preferred, ambiguous: bucket.length > 1 };
		},
	};
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const findSheet = (wb: XLSX.WorkBook, name: string): XLSX.WorkSheet | null => {
	const target = key(name);
	const match = wb.SheetNames.find((n) => key(n) === target);
	return match ? (wb.Sheets[match] ?? null) : null;
};

/** Rows plus the 1-based Excel row number of the first one. */
const readRows = (
	ws: XLSX.WorkSheet,
): { rows: unknown[][]; firstRow: number } => {
	const ref = ws["!ref"];
	if (!ref) return { rows: [], firstRow: 1 };
	const firstRow = XLSX.utils.decode_range(ref).s.r + 1;
	const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
		header: 1,
		defval: null,
		blankrows: true,
		raw: true,
	});
	return { rows, firstRow };
};

const columnLetter = (index: number) => XLSX.utils.encode_col(index);

function parsePlanSheet(
	ws: XLSX.WorkSheet,
	errors: ImportIssue[],
): Omit<ParsedPlan, "days"> {
	const { rows, firstRow } = readRows(ws);
	const values = new Map<PlanField, { value: unknown; row: number }>();

	rows.forEach((r, i) => {
		const label = key(r?.[0]);
		if (!label) return;
		const field = PLAN_FIELDS.find((f) => f.aliases.includes(label));
		if (field && !values.has(field.id)) {
			values.set(field.id, { value: r?.[1], row: firstRow + i });
		}
	});

	const issue = (field: PlanField, message: string) => {
		const spec = PLAN_FIELDS.find((f) => f.id === field);
		errors.push({
			sheet: PLAN_SHEET,
			row: values.get(field)?.row,
			column: "B",
			message: `${spec?.label.replace("*", "") ?? field}: ${message}`,
		});
	};
	const raw = (field: PlanField) => values.get(field)?.value;

	const name = text(raw("name"));
	if (!name) issue("name", "is required");
	else if (name.length > 200) issue("name", "must be 200 characters or fewer");

	const description = text(raw("description"));
	if (description.length > 2000)
		issue("description", "must be 2000 characters or fewer");

	const difficulty = difficultyOf(raw("difficulty"));
	if (isBlank(raw("difficulty"))) issue("difficulty", "is required");
	else if (!difficulty)
		issue(
			"difficulty",
			`"${text(raw("difficulty"))}" is not one of ${Object.values(ExerciseDifficulty).join(", ")}`,
		);

	const durationN = toNumber(raw("duration"));
	let duration = 0;
	if (!durationN.ok || durationN.value === null) {
		issue("duration", durationN.ok ? "is required" : "must be a number");
	} else if (
		!Number.isInteger(durationN.value) ||
		durationN.value < 1 ||
		durationN.value > 52
	) {
		issue("duration", "must be a whole number from 1 to 52");
	} else {
		duration = durationN.value;
	}

	const goal = goalOf(raw("goal"));
	if (isBlank(raw("goal"))) issue("goal", "is required");
	else if (!goal)
		issue(
			"goal",
			`"${text(raw("goal"))}" is not one of ${Object.values(PlanGoal).join(", ")}`,
		);

	let splitType: string = SplitType.Custom;
	if (!isBlank(raw("splitType"))) {
		const s = splitOf(raw("splitType"));
		if (s) splitType = s;
		else
			issue(
				"splitType",
				`"${text(raw("splitType"))}" is not one of ${Object.values(SplitType).join(", ")}`,
			);
	}

	let isTemplate = true;
	const tpl = toBool(raw("isTemplate"));
	if (!tpl.ok) issue("isTemplate", "must be Yes or No");
	else if (tpl.value !== null) isTemplate = tpl.value;

	const templateCategory = text(raw("templateCategory")) || null;
	if (templateCategory && templateCategory.length > 100) {
		issue("templateCategory", "must be 100 characters or fewer");
	}

	let status: string = PlanStatus.Active;
	if (!isBlank(raw("status"))) {
		const s = statusOf(raw("status"));
		if (s) status = s;
		else issue("status", "must be Draft or Active");
	}

	return {
		name,
		description,
		difficulty: difficulty ?? "",
		duration,
		goal: goal ?? "",
		splitType,
		status,
		isTemplate,
		templateCategory,
	};
}

interface DayDraft {
	dayNumber: number;
	name: string;
	firstRow: number;
	restRow: number | null;
	exercises: (ParsedPlanExercise & { row: number })[];
}

function parseWorkoutSheet(
	ws: XLSX.WorkSheet,
	index: ExerciseIndex,
	errors: ImportIssue[],
	warnings: ImportIssue[],
): ParsedPlanDay[] {
	const { rows, firstRow } = readRows(ws);

	// Header row: the first of the top 10 rows that names both Day and Exercise.
	let headerIdx = -1;
	const colIndex = new Map<WorkoutColumn, number>();
	for (let i = 0; i < Math.min(rows.length, 10) && headerIdx < 0; i++) {
		const cells = (rows[i] ?? []).map(key);
		const found = new Map<WorkoutColumn, number>();
		for (const spec of WORKOUT_COLUMNS) {
			const at = cells.findIndex((c) => spec.aliases.includes(c));
			if (at >= 0) found.set(spec.id, at);
		}
		if (found.has("day") && found.has("exercise")) {
			headerIdx = i;
			for (const [k, v] of found) colIndex.set(k, v);
		}
	}

	if (headerIdx < 0) {
		errors.push({
			sheet: WORKOUT_SHEET,
			message: `Header row not found. The first row must contain the column titles (${WORKOUT_COLUMNS.map((c) => c.header).join(", ")}).`,
		});
		return [];
	}
	for (const spec of WORKOUT_COLUMNS) {
		if (spec.required && !colIndex.has(spec.id)) {
			errors.push({
				sheet: WORKOUT_SHEET,
				row: firstRow + headerIdx,
				message: `Missing required column "${spec.header}".`,
			});
		}
	}
	if (errors.some((e) => e.sheet === WORKOUT_SHEET)) return [];

	const headerFor = (id: WorkoutColumn) =>
		WORKOUT_COLUMNS.find((c) => c.id === id)?.header.replace("*", "") ?? id;
	const cell = (r: unknown[], id: WorkoutColumn) => {
		const at = colIndex.get(id);
		return at === undefined ? null : r?.[at];
	};

	const days = new Map<number, DayDraft>();
	let dataRows = 0;

	for (let i = headerIdx + 1; i < rows.length; i++) {
		const r = rows[i] ?? [];
		if (r.every(isBlank)) continue;
		const rowNo = firstRow + i;

		dataRows++;
		if (dataRows > MAX_WORKOUT_ROWS) {
			errors.push({
				sheet: WORKOUT_SHEET,
				row: rowNo,
				message: `Too many rows — a plan can have at most ${MAX_WORKOUT_ROWS} exercise rows.`,
			});
			break;
		}

		const rowErr = (id: WorkoutColumn, message: string) => {
			const at = colIndex.get(id);
			errors.push({
				sheet: WORKOUT_SHEET,
				row: rowNo,
				column: at === undefined ? undefined : columnLetter(at),
				message: `${headerFor(id)}: ${message}`,
			});
		};

		// Day number
		const dayN = toNumber(cell(r, "day"));
		if (
			!dayN.ok ||
			dayN.value === null ||
			!Number.isInteger(dayN.value) ||
			dayN.value < 1
		) {
			rowErr("day", "must be a whole number of 1 or more");
			continue;
		}
		if (dayN.value > MAX_PLAN_DAYS) {
			rowErr("day", `must be ${MAX_PLAN_DAYS} or less`);
			continue;
		}
		const dayNumber = dayN.value;
		let day = days.get(dayNumber);
		if (!day) {
			day = {
				dayNumber,
				name: "",
				firstRow: rowNo,
				restRow: null,
				exercises: [],
			};
			days.set(dayNumber, day);
		}

		// Day name: first non-blank wins; a different one later is a mistake.
		const dayName = text(cell(r, "dayName"));
		if (dayName) {
			if (dayName.length > 100)
				rowErr("dayName", "must be 100 characters or fewer");
			else if (!day.name) day.name = dayName;
			else if (dayName !== day.name) {
				warnings.push({
					sheet: WORKOUT_SHEET,
					row: rowNo,
					message: `Day ${dayNumber} is already named "${day.name}"; "${dayName}" on this row is ignored.`,
				});
			}
		}

		const rest = toBool(cell(r, "restDay"));
		if (!rest.ok) {
			rowErr("restDay", "must be Yes or No");
			continue;
		}
		if (rest.value) {
			day.restRow = rowNo;
			if (!isBlank(cell(r, "exercise"))) {
				rowErr("exercise", "must be blank on a rest day row");
			}
			continue;
		}

		// Exercise
		const exerciseName = text(cell(r, "exercise"));
		if (!exerciseName) {
			rowErr("exercise", "is required (or set Rest Day = Yes)");
			continue;
		}
		const match = index.resolve(exerciseName);
		if (!match.ok) {
			rowErr(
				"exercise",
				`"${exerciseName}" is not in the exercise library${match.suggestions.length ? `. Did you mean: ${match.suggestions.join(", ")}?` : "."}`,
			);
			continue;
		}
		if (match.ambiguous) {
			warnings.push({
				sheet: WORKOUT_SHEET,
				row: rowNo,
				message: `More than one exercise is named "${match.exercise.name}"; using the ${match.exercise.isSystem ? "system" : "first"} one.`,
			});
		}

		let section: ExerciseSection = ExerciseSection.Workout;
		if (!isBlank(cell(r, "section"))) {
			const s = sectionOf(cell(r, "section"));
			if (!s) {
				rowErr(
					"section",
					`"${text(cell(r, "section"))}" must be Warmup, Workout or Stretching`,
				);
				continue;
			}
			section = s;
		}

		const intIn = (id: WorkoutColumn, min: number, max: number) => {
			const n = toNumber(cell(r, id));
			if (!n.ok) return { bad: `must be a number` };
			if (n.value === null) return { value: null };
			if (!Number.isInteger(n.value) || n.value < min || n.value > max) {
				return { bad: `must be a whole number from ${min} to ${max}` };
			}
			return { value: n.value };
		};

		let rowOk = true;
		const sets = intIn("sets", 1, 50);
		if (sets.bad || sets.value === null) {
			rowErr("sets", sets.bad ?? "is required");
			rowOk = false;
		}
		const duration = intIn("duration", 1, 86400);
		if (duration.bad) {
			rowErr("duration", duration.bad);
			rowOk = false;
		}
		const reps = intIn("reps", 1, 100);
		if (reps.bad) {
			rowErr("reps", reps.bad);
			rowOk = false;
		} else if (reps.value === null && !duration.value) {
			rowErr("reps", "is required unless Duration (sec) is filled");
			rowOk = false;
		}
		const restSec = intIn("rest", 0, 600);
		if (restSec.bad) {
			rowErr("rest", restSec.bad);
			rowOk = false;
		}
		const weightN = toNumber(cell(r, "weight"));
		let weight = 0;
		if (
			!weightN.ok ||
			(weightN.value !== null && (weightN.value < 0 || weightN.value > 999.99))
		) {
			rowErr("weight", "must be a number from 0 to 999.99");
			rowOk = false;
		} else if (weightN.value !== null) {
			weight = Math.round(weightN.value * 100) / 100;
		}
		const notes = text(cell(r, "notes"));
		if (notes.length > 1000) {
			rowErr("notes", "must be 1000 characters or fewer");
			rowOk = false;
		}
		if (!rowOk) continue;

		day.exercises.push({
			row: rowNo,
			exerciseId: match.exercise._id,
			exerciseName: match.exercise.name,
			orderIndex: 0,
			targetSets: sets.value as number,
			// Timed exercises still need targetReps ≥ 1 in the schema.
			targetReps: (reps.value as number | null) ?? 1,
			targetWeightKg: weight,
			restSeconds: (restSec.value as number | null) ?? 60,
			section,
			durationSeconds: (duration.value as number | null) ?? null,
			notes: notes || null,
		});
	}

	if (dataRows === 0) {
		errors.push({
			sheet: WORKOUT_SHEET,
			message: "No workout rows found below the header.",
		});
		return [];
	}

	// Days must be 1..N: each plan day becomes the next calendar day.
	const numbers = [...days.keys()].sort((a, b) => a - b);
	const maxDay = numbers[numbers.length - 1] ?? 0;
	const missing: number[] = [];
	for (let d = 1; d <= maxDay; d++) if (!days.has(d)) missing.push(d);
	if (missing.length > 0) {
		errors.push({
			sheet: WORKOUT_SHEET,
			message: `Day numbers must run 1 to ${maxDay} without gaps. Missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}. Add a rest-day row for days with no training.`,
		});
	}

	const result: ParsedPlanDay[] = [];
	for (const n of numbers) {
		const d = days.get(n);
		if (!d) continue;
		if (d.restRow !== null && d.exercises.length > 0) {
			errors.push({
				sheet: WORKOUT_SHEET,
				row: d.restRow,
				message: `Day ${n} is marked as a rest day but also has exercises.`,
			});
		}
		if (!d.name) {
			if (d.restRow !== null) d.name = "Rest";
			else {
				errors.push({
					sheet: WORKOUT_SHEET,
					row: d.firstRow,
					message: `Day ${n} needs a Day Name on at least one of its rows.`,
				});
			}
		}
		const ordered = d.exercises
			.map((e, i) => ({ e, i }))
			.sort(
				(a, b) =>
					SECTION_ORDER[a.e.section] - SECTION_ORDER[b.e.section] || a.i - b.i,
			)
			.map(({ e }, orderIndex) => {
				const { row: _row, ...rest } = e;
				return { ...rest, orderIndex };
			});
		result.push({
			dayNumber: n,
			name: d.name,
			isRestDay: d.restRow !== null,
			exercises: ordered,
		});
	}
	return result;
}

/**
 * Parse an uploaded workbook. Never throws on bad content — every problem is
 * reported as an issue with its sheet/row so the trainer can fix the file.
 */
export function parseWorkoutPlanWorkbook(
	buffer: Buffer,
	exercises: LibraryExercise[],
): ParseResult {
	const errors: ImportIssue[] = [];
	const warnings: ImportIssue[] = [];

	let wb: XLSX.WorkBook;
	try {
		wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
	} catch {
		return {
			plan: null,
			errors: [
				{
					sheet: "File",
					message: "The file could not be read as an Excel workbook (.xlsx).",
				},
			],
			warnings,
		};
	}

	const planWs = findSheet(wb, PLAN_SHEET);
	const workoutWs = findSheet(wb, WORKOUT_SHEET);
	if (!planWs)
		errors.push({
			sheet: PLAN_SHEET,
			message: `Sheet "${PLAN_SHEET}" is missing. Start from the downloaded template.`,
		});
	if (!workoutWs)
		errors.push({
			sheet: WORKOUT_SHEET,
			message: `Sheet "${WORKOUT_SHEET}" is missing. Start from the downloaded template.`,
		});
	if (!planWs || !workoutWs) return { plan: null, errors, warnings };

	const details = parsePlanSheet(planWs, errors);
	const days = parseWorkoutSheet(
		workoutWs,
		buildExerciseIndex(exercises),
		errors,
		warnings,
	);

	if (days.length > 0 && days.every((d) => d.isRestDay)) {
		errors.push({
			sheet: WORKOUT_SHEET,
			message: "The plan has only rest days — add at least one exercise.",
		});
	}
	if (details.duration > 0 && days.length > details.duration * 7) {
		warnings.push({
			sheet: PLAN_SHEET,
			message: `The plan has ${days.length} days but Duration is ${details.duration} week(s) (${details.duration * 7} days).`,
		});
	}

	return { plan: { ...details, days }, errors, warnings };
}
