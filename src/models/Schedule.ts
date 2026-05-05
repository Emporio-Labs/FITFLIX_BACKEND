import mongoose from "mongoose";
import { TodoStatus } from "./Enums";

const scheduleSchema = new mongoose.Schema(
	{
		user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		scheduledDate: { type: Date, required: true },
		status: {
			type: String,
			enum: Object.values(TodoStatus),
			default: TodoStatus.Todo,
			required: true,
		},
		todos: [
			{ type: mongoose.Schema.Types.ObjectId, ref: "Todo", required: true },
		],
	},
	{ timestamps: true },
);

export default (mongoose.models.Schedule as mongoose.Model<any>) ||
	mongoose.model("Schedule", scheduleSchema);
