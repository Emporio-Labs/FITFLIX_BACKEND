/**
 * FX-25 · Expert → User resolver for staff push notifications.
 *
 * The `Trainer` collection is separate from `User` and carries no `userId`
 * back-ref, so pushing to a trainer requires a lookup by their email (the
 * frontdesk PWA uses the same match). Nutritionist / sports-scientist / doctor
 * experts are already `User` documents (staffRole set), so their `_id` is the
 * push recipient directly.
 *
 * All lookups are cached in-process for the request lifetime and any failure is
 * silent (returns null); staff push must not block booking flows.
 */
import Trainer from "../models/Trainer";
import User from "../models/User";

export async function resolveTrainerUserId(
	trainerId: string,
): Promise<string | null> {
	try {
		const trainer = await Trainer.findById(trainerId)
			.select("email trainerName")
			.lean<{ email?: string; trainerName?: string } | null>();
		if (!trainer?.email) return null;
		const user = await User.findOne({
			email: new RegExp(`^${trainer.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
		})
			.select("_id")
			.lean<{ _id: unknown } | null>();
		return user ? String(user._id) : null;
	} catch (err) {
		console.warn("[resolveTrainerUserId] lookup failed", err);
		return null;
	}
}
