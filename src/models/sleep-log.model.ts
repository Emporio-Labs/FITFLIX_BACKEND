import mongoose from "mongoose";

export enum SleepSource {
	Manual = "MANUAL",
	HealthConnect = "HEALTH_CONNECT",
	AppleHealth = "APPLE_HEALTH",
}

const sleepLogSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		/** IST calendar day: YYYY-MM-DD */
		date: {
			type: String,
			required: true,
			index: true,
		},
		bedtime: {
			type: Date,
			required: true,
		},
		wakeTime: {
			type: Date,
			required: true,
		},
		durationMinutes: {
			type: Number,
			required: true,
			min: 0,
			max: 1440,
		},
		source: {
			type: String,
			enum: Object.values(SleepSource),
			default: SleepSource.Manual,
		},
		qualityScore: {
			type: Number,
			default: undefined,
			min: 1,
			max: 100,
		},
		notes: {
			type: String,
			default: undefined,
			maxlength: 500,
		},
	},
	{ timestamps: true },
);

// Compound unique index: one primary sleep log per user per date
sleepLogSchema.index({ userId: 1, date: 1 }, { unique: true });

export type SleepLogDocument = mongoose.InferSchemaType<typeof sleepLogSchema>;

const SleepLog =
	(mongoose.models.SleepLog as mongoose.Model<SleepLogDocument>) ||
	mongoose.model<SleepLogDocument>("SleepLog", sleepLogSchema);

export default SleepLog;
