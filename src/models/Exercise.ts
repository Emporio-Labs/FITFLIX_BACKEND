import mongoose from "mongoose";
import { ExerciseDifficulty, MuscleGroup } from "./Enums";

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
		imageUrl: { type: String, default: null },
		isSystem: { type: Boolean, default: false },
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
	},
	{ timestamps: true },
);

exerciseSchema.index({ muscleGroup: 1 });
exerciseSchema.index({ createdBy: 1 });
exerciseSchema.index({ name: "text" });

export type ExerciseDocument = mongoose.InferSchemaType<typeof exerciseSchema>;

const Exercise =
	(mongoose.models.Exercise as mongoose.Model<ExerciseDocument>) ||
	mongoose.model<ExerciseDocument>("Exercise", exerciseSchema);

export default Exercise;
