import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Class from "../models/Class";
import {
	checkUserMeetingAccess,
	computeAvailableSeats,
} from "../services/class.service";

/**
 * GET /api/v1/classes/:id
 * Retrieves complete group class details for the authenticated user.
 */
export const getClassById: RequestHandler = async (req, res, next): Promise<void> => {
	const { id } = req.params;

	// Validate ObjectID format - return 404 if invalid (as per acceptance criteria for 'classes/1')
	if (!id || !mongoose.Types.ObjectId.isValid(id)) {
		res.status(404).json({
			error: "Class not found",
			code: "NOT_FOUND",
		});
		return;
	}

	try {
		// Fetch the class and populate trainerName and avatarUrl from the Trainer reference
		const classDoc = await Class.findById(id).populate({
			path: "trainer",
			select: "trainerName avatarUrl",
		});

		if (!classDoc) {
			res.status(404).json({
				error: "Class not found",
				code: "NOT_FOUND",
			});
			return;
		}

		// Dynamically compute available seats
		const availableSeats = await computeAvailableSeats(
			classDoc._id.toString(),
			classDoc.capacity,
		);

		// Apply security rule for online meeting info
		let meetingInfo = null;
		if (classDoc.classType === "online") {
			const hasAccess = await checkUserMeetingAccess(
				classDoc._id.toString(),
				req.user!.id,
			);
			if (hasAccess) {
				meetingInfo = {
					url: classDoc.meetingUrl || null,
					passcode: classDoc.meetingPasscode || null,
				};
			}
		}

		// Format populated trainer response to include only id, name, avatarUrl
		const trainerDoc = classDoc.trainer as any;
		const trainerResponse = trainerDoc
			? {
					id: trainerDoc._id.toString(),
					name: trainerDoc.trainerName,
					avatarUrl: trainerDoc.avatarUrl || null,
				}
			: null;

		// Build response payload using camelCase convention
		const response = {
			id: classDoc._id.toString(),
			name: classDoc.name,
			description: classDoc.description,
			dateTime: classDoc.dateTime,
			duration: classDoc.duration,
			creditsCost: classDoc.creditsCost,
			scheduleType: classDoc.scheduleType,
			trainer: trainerResponse,
			capacity: classDoc.capacity,
			classType: classDoc.classType,
			availableSeats,
			location: classDoc.classType === "offline" ? (classDoc.location || null) : null,
			meetingInfo,
		};

		res.status(200).json({ class: response });
	} catch (error) {
		next(error);
	}
};
