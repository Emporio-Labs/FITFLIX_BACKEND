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
		// FX-17 — branches this coach may act on. The branch-scope guard reads
		// this; when empty it falls back to [locationId] so legacy single-branch
		// records keep working until they are backfilled.
		branchIds: {
			type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
			default: [],
		},
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

trainerSchema.index({ locationId: 1, isActive: 1 });
trainerSchema.index({ branchIds: 1 });

export default (mongoose.models.Trainer as mongoose.Model<any>) ||
	mongoose.model("Trainer", trainerSchema);
