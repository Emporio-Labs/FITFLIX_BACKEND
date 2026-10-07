import Booking from "../models/Bookings";
import ClassModel from "../models/Class";
import Membership from "../models/Membership";
import type { RecordingDocument } from "../models/Recording";
import { nonCancelledBookingStatusFilter } from "../utils/zego-room";

export type ReplayAccessResult =
	| { allowed: true; reason: string }
	| { allowed: false; code: string; message: string };

/**
 * FX-23.3: Verifies whether a given member is entitled to play this livestream replay.
 * Only members who could watch the livestream can play the replay; nobody else can.
 */
export async function checkReplayAccess(
	userId: string,
	userRole: string,
	recording: RecordingDocument,
): Promise<ReplayAccessResult> {
	// 1. Staff and Admins always have access
	if (["admin", "frontdesk", "branch_manager"].includes(userRole)) {
		return { allowed: true, reason: "staff_override" };
	}

	// 2. The host/trainer of the session always has access
	if (
		recording.instructorUserId &&
		String(recording.instructorUserId) === String(userId)
	) {
		return { allowed: true, reason: "session_instructor" };
	}

	// 3. Check if the parent class has open access (bookingRequirement: "NONE" or access: "ALL")
	const klass = await ClassModel.findById(recording.classId)
		.select("access bookingRequirement isSystem")
		.lean();

	const isOpenToAll =
		klass?.access === "ALL" ||
		klass?.bookingRequirement === "NONE" ||
		recording.accessSnapshot?.access === "ALL" ||
		recording.accessSnapshot?.bookingRequirement === "NONE";

	if (isOpenToAll) {
		return { allowed: true, reason: "open_class" };
	}

	// 4. Check if member had an active booking for this session
	const userBooking = await Booking.findOne({
		sessionId: recording.sessionId,
		user: userId,
		status: nonCancelledBookingStatusFilter,
	});

	if (userBooking) {
		return { allowed: true, reason: "booked_member" };
	}

	// 5. Check if member holds an active membership covering group classes
	const activeMembership = await Membership.findOne({
		user: userId,
		status: "Active",
		endDate: { $gte: new Date() },
	});

	if (activeMembership) {
		return { allowed: true, reason: "active_membership" };
	}

	// Neither open class, prior booking, nor active membership
	return {
		allowed: false,
		code: "ENTITLEMENT_REQUIRED",
		message:
			"You do not have permission to play this replay. An active membership or class booking is required.",
	};
}
