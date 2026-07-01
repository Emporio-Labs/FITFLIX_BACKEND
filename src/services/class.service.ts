import Booking from "../models/Bookings";
import { BookingStatus } from "../models/Enums";

// Existing lifecycle considers any booking that is NOT cancelled as active
const activeBookingFilter = {
	$nin: [BookingStatus.Cancelled, String(BookingStatus.Cancelled), "Cancelled"],
};

/**
 * Computes the number of available seats for a class by subtracting the count of active bookings
 * from the total class capacity.
 *
 * @param classId The class ObjectId string
 * @param totalCapacity The total capacity of the class
 * @returns Available seats count (guaranteed >= 0)
 */
export const computeAvailableSeats = async (
	classId: string,
	totalCapacity: number,
): Promise<number> => {
	const activeBookingsCount = await Booking.countDocuments({
		class_id: classId,
		status: activeBookingFilter,
	});
	return Math.max(0, totalCapacity - activeBookingsCount);
};

/**
 * Checks if a user has an active booking for a specific class to determine meeting access.
 *
 * @param classId The class ObjectId string
 * @param userId The requesting user's ObjectId string
 * @returns True if the user has an active booking, false otherwise
 */
export const checkUserMeetingAccess = async (
	classId: string,
	userId: string,
): Promise<boolean> => {
	const hasActiveBooking = await Booking.exists({
		class_id: classId,
		user: userId,
		status: activeBookingFilter,
	});
	return !!hasActiveBooking;
};
