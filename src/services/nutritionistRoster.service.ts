import mongoose from "mongoose";
import User from "../models/User";
import NutritionistBooking from "../models/NutritionistBooking";
import ExpertAppointment from "../models/ExpertAppointment";
import { ExpertType } from "../models/Enums";

export type NutritionistRosterErrorCode = "INVALID_ARGUMENT" | "NOT_YOUR_MEMBER";

export class NutritionistRosterError extends Error {
	public readonly code: NutritionistRosterErrorCode;

	constructor(code: NutritionistRosterErrorCode, message: string) {
		super(message);
		this.name = "NutritionistRosterError";
		this.code = code;
	}
}

/** All member ids currently assigned to or booked with this nutritionist. */
export const getNutritionistClientIds = async (
	nutritionistId: string,
): Promise<string[]> => {
	if (!mongoose.Types.ObjectId.isValid(nutritionistId)) {
		throw new NutritionistRosterError("INVALID_ARGUMENT", "Invalid nutritionist id");
	}

	const nutObjId = new mongoose.Types.ObjectId(nutritionistId);
	const nutUser = await User.findById(nutObjId).select("username email").lean();
	const nutName = nutUser?.username;

	const bookingQuery: any = {
		$or: [{ assignedNutritionistId: nutObjId }],
	};
	if (nutName) {
		bookingQuery.$or.push({ assignedNutritionistName: nutName });
	}

	const apptQuery: any = {
		expertType: ExpertType.Nutritionist,
		$or: [{ assignedExpertId: nutObjId }],
	};
	if (nutName) {
		apptQuery.$or.push({ assignedExpertName: nutName });
	}

	const [bookingUsers, apptUsers, directUsers] = await Promise.all([
		NutritionistBooking.distinct("userId", bookingQuery),
		ExpertAppointment.distinct("userId", apptQuery),
		User.find({
			$or: [
				{ assignedNutritionistId: nutObjId },
				{ assignedNutritionist: nutObjId },
			],
		}).select("_id").lean(),
	]);

	const idSet = new Set<string>();
	for (const id of bookingUsers) if (id) idSet.add(id.toString());
	for (const id of apptUsers) if (id) idSet.add(id.toString());
	for (const u of directUsers) idSet.add(u._id.toString());

	return Array.from(idSet);
};

/**
 * Throws NutritionistRosterError("NOT_YOUR_MEMBER") unless `userId` is on
 * `nutritionistId`'s client roster.
 */
export const assertNutritionistOwnsMember = async (
	nutritionistId: string,
	userId: string,
): Promise<void> => {
	if (!mongoose.Types.ObjectId.isValid(userId)) {
		throw new NutritionistRosterError("INVALID_ARGUMENT", "Invalid member id");
	}

	const clientIds = await getNutritionistClientIds(nutritionistId);
	if (!clientIds.includes(userId)) {
		throw new NutritionistRosterError(
			"NOT_YOUR_MEMBER",
			"This member is not assigned to your nutrition roster",
		);
	}
};
