import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

const adminSchema = new mongoose.Schema(
	{
		adminName: { type: String, required: true },
		email: { type: String, required: true, unique: true, sparse: true },
		phone: { type: String, required: true },
		passwordHash: { type: String, required: true, select: false },
	},
	{ timestamps: true },
);

applyIdTransform(adminSchema);

export default (mongoose.models.Admin as mongoose.Model<any>) ||
	mongoose.model("Admin", adminSchema);
