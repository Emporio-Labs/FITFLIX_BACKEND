import mongoose from "mongoose";
import { ExerciseDifficulty, ExerciseSection, MuscleGroup } from "./Enums";

const exerciseSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		muscleGroup: {
			type: String,
			enum: Object.values(MuscleGroup),
			required: true,
		},
		targetedMuscles: { type: [String], default: [] },
		difficulty: {
			type: String,
			enum: Object.values(ExerciseDifficulty),
			required: true,
		},
		equipment: { type: String, default: "" },
		instructions: { type: String, default: "" },
		commonMistakes: { type: [String], default: [] },
		tips: { type: [String], default: [] },
		caloriesPerSet: { type: Number, default: 0 },
		// Which workout sections this exercise can be used in.
		// Defaults to ["workout"] so pre-existing exercises stay in the
		// main workout section.
		sectionTypes: {
			type: [String],
			enum: Object.values(ExerciseSection),
			default: ["workout"],
		},
		imageUrl: { type: String, default: null },
		isSystem: { type: Boolean, default: false },
		// Soft delete. Plans and assignments store only `exerciseId`, and every
		// read re-joins against this collection to resolve the name, so removing
		// a row orphans every plan day and assignment day that referenced it —
		// they render as "Deleted exercise" with no way to recover the name.
		// Deleting therefore only sets this flag: name-resolution joins ignore
		// it so existing references keep working, and the list/detail endpoints
		// filter on it so the exercise disappears from every picker.
		isDeleted: { type: Boolean, default: false },
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
	},
	{ timestamps: true },
);

exerciseSchema.index({ isDeleted: 1, name: 1 });
exerciseSchema.index({ muscleGroup: 1 });
exerciseSchema.index({ createdBy: 1 });
exerciseSchema.index({ sectionTypes: 1 });
exerciseSchema.index({ name: "text" });

export type ExerciseDocument = mongoose.InferSchemaType<typeof exerciseSchema>;

const Exercise =
	(mongoose.models.Exercise as mongoose.Model<ExerciseDocument>) ||
	mongoose.model<ExerciseDocument>("Exercise", exerciseSchema);

export default Exercise;
