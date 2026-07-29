import mongoose from "mongoose";
import User from "../models/User";

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

	const members = await User.find({ assignedTrainer: trainerId })
		.select("_id")
		.lean();

	return members.map((member) => member._id.toString());
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

	const member = await User.findById(userId).select("assignedTrainer").lean();
	if (!member || member.assignedTrainer?.toString() !== trainerId) {
		throw new TrainerRosterError(
			"NOT_YOUR_MEMBER",
			"This member is not assigned to you",
		);
	}
};
