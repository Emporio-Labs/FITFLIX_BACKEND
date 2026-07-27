import ScheduledSession from "../models/ScheduledSession";

export interface SeatAllocationResult {
	success: boolean;
	session?: any;
	reason?: string;
}

/**
 * Atomically allocates 1 seat for a scheduled class session.
 * Uses atomic conditional update ($gt: 0) to prevent race conditions & overbooking.
 */
export async function allocateSeatAtomic(
	sessionId: string,
): Promise<SeatAllocationResult> {
	const session = await ScheduledSession.findOne({ _id: sessionId });

	if (!session) {
		return { success: false, reason: "SESSION_NOT_FOUND" };
	}

	if (session.status === "CANCELLED" || session.status === "COMPLETED") {
		return { success: false, reason: `SESSION_${session.status}` };
	}

	// Atomic conditional increment/decrement
	const updatedSession = await ScheduledSession.findOneAndUpdate(
		{
			_id: sessionId,
			status: { $in: ["SCHEDULED"] },
			remainingCapacity: { $gt: 0 },
		},
		{
			$inc: {
				currentBookings: 1,
				remainingCapacity: -1,
			},
		},
		{ new: true },
	);

	if (!updatedSession) {
		return { success: false, reason: "FULL_OR_LOCKED" };
	}

	// Automated status transition to FULL when capacity reaches 100%
	if (updatedSession.remainingCapacity === 0 && updatedSession.status !== "FULL") {
		updatedSession.status = "FULL";
		await updatedSession.save();
	}

	return { success: true, session: updatedSession };
}

/**
 * Atomically releases 1 seat when a booking is cancelled or refunded.
 */
export async function releaseSeatAtomic(
	sessionId: string,
): Promise<SeatAllocationResult> {
	const updatedSession = await ScheduledSession.findOneAndUpdate(
		{
			_id: sessionId,
			currentBookings: { $gt: 0 },
		},
		{
			$inc: {
				currentBookings: -1,
				remainingCapacity: 1,
			},
		},
		{ new: true },
	);

	if (!updatedSession) {
		return { success: false, reason: "NO_BOOKINGS_TO_RELEASE" };
	}

	// Restore status to SCHEDULED if previously FULL
	if (updatedSession.status === "FULL" && updatedSession.remainingCapacity > 0) {
		updatedSession.status = "SCHEDULED";
		await updatedSession.save();
	}

	return { success: true, session: updatedSession };
}

/**
 * Administrative capacity adjustment endpoint service.
 * Returns 400 Bad Request error if new capacity is lower than confirmed bookings.
 */
export async function updateCapacityAdmin(
	sessionId: string,
	newCapacity: number,
) {
	const session = await ScheduledSession.findById(sessionId);
	if (!session) {
		return { status: 404, message: "Scheduled session not found" };
	}

	if (newCapacity < session.currentBookings) {
		return {
			status: 400,
			message: `Cannot reduce capacity below currently confirmed bookings (${session.currentBookings} confirmed)`,
			confirmedBookings: session.currentBookings,
		};
	}

	const newRemaining = newCapacity - session.currentBookings;
	session.capacity = newCapacity;
	session.remainingCapacity = newRemaining;

	if (newRemaining === 0 && session.status === "SCHEDULED") {
		session.status = "FULL";
	} else if (newRemaining > 0 && session.status === "FULL") {
		session.status = "SCHEDULED";
	}

	await session.save();

	return {
		status: 200,
		message: "Capacity updated successfully",
		session,
	};
}
