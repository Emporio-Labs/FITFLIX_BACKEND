import mongoose from "mongoose";

const trainerSchema = new mongoose.Schema(
	{
		trainerName: { type: String, required: true },
		email: { type: String, required: true, unique: true, sparse: true },
		phone: { type: String, required: true },
		passwordHash: { type: String, required: true, select: false },
		description: { type: String, default: "" },
		specialities: { type: [String], default: [] },
		imageUrl: { type: String, default: "" },
		keySentence: { type: String, default: "" },
		// Branch this coach works out of. Optional on the schema so existing
		// records hydrate, but the seed stamps every trainer and the API
		// resolves it on create.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

trainerSchema.index({ locationId: 1, isActive: 1 });

export default (mongoose.models.Trainer as mongoose.Model<any>) ||
	mongoose.model("Trainer", trainerSchema);
