import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
	{
		summary: { type: String, required: true },
		suggestions: { type: String, required: true },
		media: { type: [String], default: [] },
	},
	{ timestamps: true },
);
