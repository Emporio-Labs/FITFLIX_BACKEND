import mongoose from "mongoose";

/**
 * One row per member for the morning sleep check-in push
 * (services/sleep-checkin.service.ts).
 *
 * `lastSentDate` is also the send lock: the sweep claims a member by moving it
 * to today with an atomic upsert, so two instances (or the in-process poller
 * plus the external /internal/reminders/tick) can never both send one.
 *
 * `_id` *is* the member's id. The lock leans on MongoDB refusing a second
 * document with the same `_id`, which it always enforces. A separate unique
 * index on `userId` only exists once Mongoose has built it, and an
 * overlapping sweep that ran before then sent the reminder three times.
 */
const sleepCheckInStateSchema = new mongoose.Schema(
	{
		_id: { type: mongoose.Schema.Types.ObjectId, required: true },
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		/** IST day (YYYY-MM-DD) the last check-in went out. */
		lastSentDate: { type: String, default: null },
		/**
		 * Check-ins in a row the member didn't follow with any sleep log.
		 * At SLEEP_CHECKIN.pauseAfterIgnored they stop until the member logs a
		 * night again, so an ignored reminder never turns into daily nagging.
		 */
		ignoredInARow: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true },
);

export type SleepCheckInStateDocument = mongoose.InferSchemaType<
	typeof sleepCheckInStateSchema
>;

const SleepCheckInState =
	(mongoose.models.SleepCheckInState as mongoose.Model<SleepCheckInStateDocument>) ||
	mongoose.model<SleepCheckInStateDocument>(
		"SleepCheckInState",
		sleepCheckInStateSchema,
	);

export default SleepCheckInState;
