import type mongoose from "mongoose";
import Slot from "../models/Slots";

/// Shared slot-reservation primitives.
///
/// These used to live privately inside `booking.controller.ts`, where only the
/// therapy flow could reach them. The nutritionist flow hand-rolled its own
/// (incorrect) reservation instead: it decremented `remainingCapacity` on
/// whatever slot id the client sent, which for a daily template drains that
/// template globally, across every date, permanently. Extracting them here
/// gives both flows one reservation path with per-date semantics.

export const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

export const isSameUtcDate = (left: Date, right: Date): boolean =>
	normalizeToUtcDate(left).getTime() === normalizeToUtcDate(right).getTime();

export type ReservableSlot = {
	_id: mongoose.Types.ObjectId;
	date?: Date | null;
	isDaily?: boolean;
	startTime: string;
	endTime: string;
	capacity?: number;
	parentTemplate?: mongoose.Types.ObjectId | null;
};

/// Resolve the concrete, per-date slot document that a booking on [bookingDate]
/// should actually consume.
///
/// · A slot that already has a `parentTemplate` is itself concrete — it is
///   returned as-is, but only when its date matches the booking date.
/// · A daily template (`isDaily`, no parent) is *materialized*: a child slot
///   carrying the template's capacity is upserted for that specific day and
///   returned. The template document is never mutated, so its capacity is
///   available again tomorrow.
/// · A one-off dated slot is returned only when its date matches.
///
/// Returns `null` when the slot cannot serve [bookingDate].
export const resolveConcreteSlotForBooking = async (
	slot: ReservableSlot,
	bookingDate: Date,
) => {
	const bookingDay = normalizeToUtcDate(bookingDate);

	if (slot.parentTemplate) {
		if (!slot.date || !isSameUtcDate(slot.date, bookingDay)) {
			return null;
		}

		return slot;
	}

	if (slot.isDaily) {
		const templateCapacity = Math.max(1, Number(slot.capacity ?? 1));

		const concreteSlot = await Slot.findOneAndUpdate(
			{
				parentTemplate: slot._id,
				date: bookingDay,
				startTime: slot.startTime,
				endTime: slot.endTime,
			},
			{
				$setOnInsert: {
					date: bookingDay,
					isDaily: false,
					startTime: slot.startTime,
					endTime: slot.endTime,
					capacity: templateCapacity,
					remainingCapacity: templateCapacity,
					isBooked: templateCapacity <= 0,
					parentTemplate: slot._id,
				},
			},
			{
				upsert: true,
				setDefaultsOnInsert: true,
				returnDocument: "after",
			},
		);

		return concreteSlot;
	}

	if (!slot.date || !isSameUtcDate(slot.date, bookingDay)) {
		return null;
	}

	return slot;
};

/// Atomically take one seat from [slotId]. Returns the updated slot, or `null`
/// when there was nothing left to take — callers translate that into their own
/// "slot is full" response.
export const reserveSlotCapacity = async (slotId: string) => {
	let reservedSlot = await Slot.findOneAndUpdate(
		{ _id: slotId, remainingCapacity: { $gt: 0 } },
		{ $inc: { remainingCapacity: -1 } },
		{ returnDocument: "after" },
	);

	if (!reservedSlot) {
		return null;
	}

	const derivedBooked = Number(reservedSlot.remainingCapacity ?? 0) <= 0;

	if (reservedSlot.isBooked !== derivedBooked) {
		const syncedSlot = await Slot.findByIdAndUpdate(
			slotId,
			{ isBooked: derivedBooked },
			{ returnDocument: "after" },
		);

		if (syncedSlot) {
			reservedSlot = syncedSlot;
		}
	}

	return reservedSlot;
};

/// Give a seat back. The `$expr` guard makes this idempotent-ish: a slot
/// already at full capacity is left alone rather than inflated past it.
export const releaseSlotCapacity = async (
	slotId: string,
	session?: mongoose.ClientSession,
): Promise<void> => {
	await Slot.findOneAndUpdate(
		{
			_id: slotId,
			$expr: {
				$lt: [
					{ $ifNull: ["$remainingCapacity", 0] },
					{ $ifNull: ["$capacity", 1] },
				],
			},
		},
		{
			$max: { capacity: 1 },
			$inc: { remainingCapacity: 1 },
			$set: { isBooked: false },
		},
		{ returnDocument: "after", ...(session ? { session } : {}) },
	);
};
