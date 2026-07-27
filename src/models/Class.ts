import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const classSchema = new mongoose.Schema(
	{
		_id: {
			type: String,
			default: () => randomUUID(),
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
		description: {
			type: String,
			default: "",
			trim: true,
		},
		status: {
			type: String,
			enum: ["ACTIVE", "INACTIVE"],
			default: "ACTIVE",
			required: true,
			index: true,
		},
		creditCost: {
			type: Number,
			required: true,
			min: 1,
		},
		isPublished: {
			type: Boolean,
			default: true,
		},
	},
	{
		timestamps: true,
	},
);

type ClassDocument = mongoose.InferSchemaType<typeof classSchema>;

export default (mongoose.models.Class as mongoose.Model<ClassDocument>) ||
	mongoose.model<ClassDocument>("Class", classSchema);
