import mongoose from "mongoose";
import User from "../models/User";
import UnifiedBooking from "../models/UnifiedBooking";
import Membership from "../models/Membership";

export type TrainerRosterErrorCode = "INVALID_ARGUMENT" | "NOT_YOUR_MEMBER";

export class TrainerRosterError extends Error {
	public readonly code: TrainerRosterErrorCode;

	constructor(code: TrainerRosterErrorCode, message: string) {
		super(message);
		this.name = "TrainerRosterError";
		this.code = code;
	}
}

/** All member ids currently assigned to this trainer. */
export const getRosterUserIds = async (trainerId: string): Promise<string[]> => {
	if (!mongoose.Types.ObjectId.isValid(trainerId)) {
		throw new TrainerRosterError("INVALID_ARGUMENT", "Invalid trainer id");
	}

	const trainerObjId = new mongoose.Types.ObjectId(trainerId);

	const [directUsers, bookingUsers, membershipUsers] = await Promise.all([
		User.find({ assignedTrainer: trainerId }).select("_id").lean(),
		UnifiedBooking.distinct("userId", { expertId: trainerObjId }),
		Membership.distinct("userId", { assignedTrainer: trainerObjId }),
	]);

	const idSet = new Set<string>();
	for (const u of directUsers) idSet.add(u._id.toString());
	for (const id of bookingUsers) if (id) idSet.add(id.toString());
	for (const id of membershipUsers) if (id) idSet.add(id.toString());

	return Array.from(idSet);
};

/**
 * Throws TrainerRosterError("NOT_YOUR_MEMBER") unless `userId` is on
 * `trainerId`'s roster. Callers decide whether admins bypass this check —
 * it always enforces ownership for the trainer id given.
 */
export const assertTrainerOwnsMember = async (
	trainerId: string,
	userId: string,
): Promise<void> => {
	if (!mongoose.Types.ObjectId.isValid(userId)) {
		throw new TrainerRosterError("INVALID_ARGUMENT", "Invalid member id");
	}

	const rosterIds = await getRosterUserIds(trainerId);
	if (!rosterIds.includes(userId)) {
		throw new TrainerRosterError(
			"NOT_YOUR_MEMBER",
			"This member is not assigned to you",
		);
	}
};
