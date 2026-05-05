import mongoose from "mongoose";
import { TodoStatus } from "./Enums";

const todoSchema = new mongoose.Schema(
	{
		todoStatus: {
			type: String,
			enum: Object.values(TodoStatus),
			default: TodoStatus.Todo,
			required: true,
		},
		task: { type: String, required: true },
		description: { type: String, required: true },
	},
	{ timestamps: true },
);

export default (mongoose.models.Todo as mongoose.Model<any>) ||
	mongoose.model("Todo", todoSchema);
