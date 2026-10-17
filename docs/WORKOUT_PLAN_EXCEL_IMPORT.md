# Workout plan Excel import

Trainers and admins can build a workout template in Excel and upload it in
FrontDesk (**Workout Templates → Import from Excel**). The upload creates the
same `WorkoutPlan` document the plan builder does, so imported plans can be
edited, duplicated and assigned like any other.

- Template: `GET /workout-plans/import/template`
- Upload: `POST /workout-plans/import` (`?dryRun=true` to preview)
- Export an existing plan in the same format: `GET /workout-plans/:id/export`
  (FrontDesk: **Export to Excel** on the plan page). Edit it and import it back
  as a new plan.
- Code: `src/utils/workout-plan-excel.ts` (format, parser, export),
  `src/utils/xlsx-enhance.ts` (drop-downs, frozen header, styles),
  `src/controllers/workout-plan-import.controller.ts`
- Tests: `bun run test:workout-plan-excel`
- Sample files: `bun run generate:workout-plan-samples [outDir]` writes the
  blank template plus three filled plans (beginner full body 1 week, push/pull/legs
  2 weeks, fat-loss circuit 4 weeks) built from the seeded library. Each one is
  re-imported before it's written.

Always start from the downloaded template. It holds the current exercise
library, so names copied from it match.

---

## Workbook layout

| Sheet | Read on upload? | Purpose |
|---|---|---|
| Instructions | no | How-to and column rules |
| **Plan Details** | **yes** | Plan-level fields, one per row |
| **Workout** | **yes** | One row per exercise |
| Example | no | A filled-in sample plan |
| Exercise Library | no | Every exercise you can use (system + your own), with muscle groups, equipment, sections |
| Allowed Values | no | Lists for every drop-down-style field |

Sheet names are matched case-insensitively. The other sheets can be deleted,
except *Exercise Library* and *Allowed Values*, which feed the drop-downs.

### Built-in helpers

- **Drop-downs** for Difficulty, Goal, Split Type, Save as Template, Status,
  Rest Day, Section and **Exercise** (the whole library).
- **Number and length rules** on Day, Sets, Reps, Weight, Rest, Duration and the
  text fields. Excel refuses out-of-range values as they're typed.
- **A tip pops up** when a cell is selected.
- **Header rows are frozen.** Required fields/columns are yellow, optional ones grey.

These guard typing only. Pasted values skip Excel's checks, so the upload
validates everything again.

---

## Sheet 1 — Plan Details

Labels go in column **A** and values in column **B**. Row order doesn't matter.

| Field (col A) | Required | Allowed values | Maps to |
|---|---|---|---|
| Plan Name | ✅ | text, ≤ 200 chars | `name` |
| Description | | text, ≤ 2000 chars | `description` |
| Difficulty | ✅ | Beginner, Intermediate, Advanced | `difficulty` |
| Duration (weeks) | ✅ | whole number 1–52 | `duration` |
| Goal | ✅ | Strength, Hypertrophy, Endurance, WeightLoss, Maintenance, MuscleGain, Mobility, GeneralFitness, Custom | `goal` |
| Split Type | | FullBody, UpperLower, PushPull, PushPullLegs, BroSplit, Custom (blank = Custom) | `splitType` |
| Save as Template | | Yes / No (blank = **Yes**) | `isTemplate` |
| Template Category | | text, ≤ 100 chars (e.g. Fat Loss) | `templateCategory` |
| Status | | Draft / Active (blank = **Active**) | `status` |

Enum values are forgiving: case, spaces, `-` and `_` are ignored, so
`weight loss`, `Weight_Loss` and `WEIGHTLOSS` all mean `WeightLoss`.

---

## Sheet 2 — Workout

Row 1 is the header row. Columns are found by their header text, so they can
be reordered and the `*` is optional.

| Column | Required | Rules | Maps to |
|---|---|---|---|
| **Day** | ✅ | Whole number. Days run 1, 2, 3 … **with no gaps**. Repeat it on every row of that day. | `days[].dayNumber` |
| **Day Name** | ✅ once per day | Title the member sees, e.g. "Push Day". Fill it on any row of the day (usually the first). Later different values are ignored with a warning. | `days[].name` |
| Rest Day | | `Yes` = rest day. Use one row with Day, Day Name (optional, defaults to "Rest") and Rest Day = Yes, and no exercise. | `days[].isRestDay` |
| Section | | Warmup, Workout, Stretching (also accepts "warm up", "cool down", "stretch"). Blank = Workout. | `section` |
| **Exercise** | ✅ | Name from the **Exercise Library** sheet. Case and punctuation are ignored (`push up` = `Push-Up`). Unknown names are rejected with "Did you mean …" suggestions. | `exerciseId` |
| **Sets** | ✅ | Whole number 1–50 | `targetSets` |
| Reps | ✅ unless timed | Whole number 1–100. Leave blank only for timed exercises (fill Duration). | `targetReps` (1 when timed) |
| Weight (kg) | | 0–999.99. Blank = 0 (bodyweight). | `targetWeightKg` |
| Rest (sec) | | Rest between sets, 0–600. Blank = 60. | `restSeconds` |
| Duration (sec) | | Seconds per set for timed work (plank, cardio, stretches). | `durationSeconds` |
| Notes | | Coaching cue, ≤ 1000 chars | `notes` |

### How days become a schedule

When the plan is assigned, **each Day is one calendar day**, in order, from the
start date (`initializeSchedule`). That is why day numbers can't have gaps and
rest days need their own row. *Duration (weeks)* is a label only. A 4-week
plan that should run four weeks needs 28 days of rows; a 7-day plan is
scheduled for 7 days. A warning appears when the day count exceeds
Duration × 7.

### Exercise order

Within a day, exercises are grouped **Warmup → Workout → Stretching**. Inside
each group they keep their row order, so rows don't have to be sorted by
section. Empty rows are skipped.

### Example

| Day | Day Name | Rest Day | Section | Exercise | Sets | Reps | Weight (kg) | Rest (sec) | Duration (sec) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Full Body A | | Warmup | Jumping Jacks | 2 | | | 30 | 45 | |
| 1 | | | Workout | Bodyweight Squats | 3 | 15 | 0 | 60 | | Knees track over toes |
| 1 | | | Workout | Push Ups | 3 | 10 | 0 | 60 | | Drop to knees if needed |
| 1 | | | Workout | Plank Hold | 3 | | | 45 | 30 | |
| 1 | | | Stretching | Hamstring Stretch | 1 | | | 0 | 60 | |
| 2 | Rest | Yes | | | | | | | | |
| 3 | Full Body B | | Workout | Single Arm Dumbbell Row | 3 | 12 | 10 | 60 | | |

---

## Validation and responses

The whole file is checked before anything is saved, and every problem is
reported at once with its sheet, Excel row and column letter. For example:

```json
{ "sheet": "Workout", "row": 7, "column": "E",
  "message": "Exercise: \"Bench Pres\" is not in the exercise library. Did you mean: Barbell Bench Press?" }
```

Errors block the import. Warnings don't block it:

- an exercise name that exists more than once in the library (the system
  exercise is used);
- a second, different Day Name for the same day;
- more days than Duration × 7.

After parsing, the plan also goes through `createPlanBodySchema`, the same
validator `POST /workout-plans` uses, so the two paths can't drift apart.

Limits: `.xlsx` only, 5 MB, 2000 exercise rows, 366 days.

Exercise matching uses the same visibility as the exercise picker: system
exercises plus the uploader's own, never soft-deleted ones.

## Export

`GET /workout-plans/:id/export` writes a plan into the same template:

- Timed exercises (duration set, reps 1) export with blank Reps.
- Paused/Completed/Archived plans export as `Active`, since the import accepts
  only Draft or Active.
- A training day with no exercises exports as a named rest day.
- An exercise that has since been removed from the library exports by its old
  name and must be swapped before re-importing. The upload error says so.
