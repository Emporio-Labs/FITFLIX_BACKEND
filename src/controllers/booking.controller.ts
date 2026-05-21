import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Booking from "../models/Bookings";
import { BookingStatus, CreditTransactionSource } from "../models/Enums";
import { HpodReport } from "../models/Hpodreport.model";
import Service from "../models/Service";
import Slot from "../models/Slots";

void HpodReport;
import {
	consumeCredits,
	refundCreditsBySource,
} from "../utils/credit.service";
import {
	changeBookingStatusBodySchema,
	createBookingBodySchema,
	updateBookingBodySchema,
} from "../validators/booking.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const getRequiredAuthenticatedUser = (req: Parameters<RequestHandler>[0]) => {
	if (!req.user) {
		return null;
	}

	return req.user;
};

const isCancelledBookingStatus = (status: unknown): boolean =>
	status === BookingStatus.Cancelled ||
	status === String(BookingStatus.Cancelled) ||
	status === "Cancelled";

const nonCancelledBookingStatusFilter = {
	$nin: [BookingStatus.Cancelled, String(BookingStatus.Cancelled), "Cancelled"],
};

const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const isSameUtcDate = (left: Date, right: Date): boolean =>
	normalizeToUtcDate(left).getTime() === normalizeToUtcDate(right).getTime();

const isSlotLinkedToService = (
	serviceSlotIds: Array<mongoose.Types.ObjectId>,
	slot: {
		_id: mongoose.Types.ObjectId;
		parentTemplate?: mongoose.Types.ObjectId | null;
	},
): boolean => {
	const linkedSlotId = slot.parentTemplate
		? slot.parentTemplate.toString()
		: slot._id.toString();

	return serviceSlotIds.some(
		(serviceSlotId) => serviceSlotId.toString() === linkedSlotId,
	);
};

const resolveConcreteSlotForBooking = async (
	slot: {
		_id: mongoose.Types.ObjectId;
		date?: Date | null;
		isDaily?: boolean;
		startTime: string;
		endTime: string;
		capacity?: number;
		parentTemplate?: mongoose.Types.ObjectId | null;
	},
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

const reserveSlotCapacity = async (slotId: string) => {
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

const releaseSlotCapacity = async (
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

export const createBooking: RequestHandler = async (req, res, next) => {
	const parsedBody = createBookingBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid booking payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const { bookingDate, userId, slotId, serviceId, reportId, bypassCredits } =
		parsedBody.data;
	const targetUserId = requester.role === "user" ? requester.id : userId;

	if (!targetUserId) {
		res.status(400).json({ message: "userId is required for admin bookings" });
		return;
	}

	if (
		!mongoose.Types.ObjectId.isValid(targetUserId) ||
		!mongoose.Types.ObjectId.isValid(slotId) ||
		!mongoose.Types.ObjectId.isValid(serviceId) ||
		(reportId && !mongoose.Types.ObjectId.isValid(reportId))
	) {
		res.status(400).json({ message: "Invalid booking references" });
		return;
	}

	if (bypassCredits && requester.role !== "admin") {
		res
			.status(403)
			.json({ message: "Only admins can bypass credit consumption" });
		return;
	}

	let reservedSlotId: string | null = null;

	try {
		const service = await Service.findById(serviceId).select(
			"_id creditCost slots",
		);

		if (!service) {
			res.status(404).json({ message: "Service not found" });
			return;
		}

		const requestedSlot = await Slot.findById(slotId).select(
			"_id date isDaily startTime endTime capacity remainingCapacity isBooked parentTemplate",
		);

		if (
			!requestedSlot ||
			!isSlotLinkedToService(service.slots, requestedSlot)
		) {
			res.status(409).json({ message: "Slot is full or no longer available" });
			return;
		}

		const concreteSlot = await resolveConcreteSlotForBooking(
			requestedSlot,
			bookingDate,
		);

		if (!concreteSlot) {
			res.status(409).json({ message: "Slot is full or no longer available" });
			return;
		}

		const reservedSlot = await reserveSlotCapacity(concreteSlot._id.toString());

		if (!reservedSlot) {
			res.status(409).json({ message: "Slot is full or no longer available" });
			return;
		}

		const concreteReservedSlotId = reservedSlot._id.toString();
		reservedSlotId = concreteReservedSlotId;

		const creditCost = Math.max(1, Number(service.creditCost ?? 1));

		const booking = await Booking.create({
			bookingDate,
			startTime: concreteSlot.startTime,
			endTime: concreteSlot.endTime,
			user: targetUserId,
			slot: concreteReservedSlotId,
			service: serviceId,
			creditCostSnapshot: creditCost,
			creditsBypassed: bypassCredits,
			...(reportId ? { report: reportId } : {}),
		});

		if (!bypassCredits) {
			try {
				await consumeCredits({
					userId: targetUserId,
					amount: creditCost,
					sourceType: CreditTransactionSource.Booking,
					sourceId: booking._id.toString(),
					actorId: requester.id,
					actorRole: requester.role,
					reason: `Booking ${booking._id.toString()}`,
				});
			} catch (error) {
				await Booking.findByIdAndDelete(booking._id).catch(() => null);

				if (reservedSlotId) {
					await releaseSlotCapacity(reservedSlotId).catch(() => null);
					reservedSlotId = null;
				}

				throw error;
			}
		}

		res.status(201).json({
			message: "Booking created",
			booking,
			credits: {
				consumed: bypassCredits ? 0 : creditCost,
				bypassed: bypassCredits,
			},
		});
	} catch (error) {
		if (reservedSlotId) {
			await releaseSlotCapacity(reservedSlotId).catch(() => null);
		}

		next(error);
	}
};

export const getAllBookings: RequestHandler = async (_req, res, next) => {
	try {
		const bookings = await Booking.find()
			.populate("user", "username email phone")
			.populate("service", "serviceName serviceType creditCost")
			.populate("slot", "date startTime endTime")
			.populate("report", "subject hasPdf");
		res.status(200).json({ bookings });
	} catch (error) {
		next(error);
	}
};

export const getBookingById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid booking id" });
		return;
	}

	try {
		const booking = await Booking.findById(id)
			.populate("user", "username email phone")
			.populate("service", "serviceName serviceType creditCost")
			.populate("slot", "date startTime endTime")
			.populate("report", "subject hasPdf");

		if (!booking) {
			res.status(404).json({ message: "Booking not found" });
			return;
		}

		res.status(200).json({ booking });
	} catch (error) {
		next(error);
	}
};

export const getMyBookings: RequestHandler = async (req, res, next) => {
	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	if (requester.role !== "user") {
		res.status(403).json({ message: "Forbidden" });
		return;
	}

	try {
		const bookings = await Booking.find({ user: requester.id })
			.populate("user", "username email phone")
			.populate("service", "serviceName serviceType creditCost")
			.populate("slot", "date startTime endTime")
			.populate("report", "subject hasPdf");
		res.status(200).json({ bookings });
	} catch (error) {
		next(error);
	}
};

export const updateBookingById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid booking id" });
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const parsedBody = updateBookingBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid booking update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { bookingDate, slotId, serviceId, reportId } = parsedBody.data;

	if (
		(slotId && !mongoose.Types.ObjectId.isValid(slotId)) ||
		(serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) ||
		(reportId && !mongoose.Types.ObjectId.isValid(reportId))
	) {
		res.status(400).json({ message: "Invalid booking references" });
		return;
	}

	let newReservedSlotId: string | null = null;

	try {
		// Fetch the existing booking
		const existingBooking = await Booking.findById(id);

		if (!existingBooking) {
			res.status(404).json({ message: "Booking not found" });
			return;
		}

		// Authorization check: users can only update their own bookings
		if (
			requester.role === "user" &&
			existingBooking.user.toString() !== requester.id
		) {
			res.status(403).json({ message: "Forbidden" });
			return;
		}

		if (isCancelledBookingStatus(existingBooking.status)) {
			res.status(409).json({
				message:
					"Cancelled bookings are immutable and cannot be updated or rescheduled",
			});
			return;
		}

		const shouldReschedule = Boolean(slotId || bookingDate);

		let rescheduleConcreteSlot: { startTime: string; endTime: string } | null =
			null;

		// If slot or booking date is being changed, handle the reschedule logic
		if (shouldReschedule) {
			const newSlotId = slotId || existingBooking.slot.toString();
			const newDate = bookingDate || existingBooking.bookingDate;

			// Fetch the service to validate the new slot
			const service = await Service.findById(
				serviceId || existingBooking.service.toString(),
			).select("_id creditCost slots");

			if (!service) {
				res.status(404).json({ message: "Service not found" });
				return;
			}

			// Fetch the new slot
			const requestedSlot = await Slot.findById(newSlotId).select(
				"_id date isDaily startTime endTime capacity remainingCapacity isBooked parentTemplate",
			);

			if (
				!requestedSlot ||
				!isSlotLinkedToService(service.slots, requestedSlot)
			) {
				res
					.status(409)
					.json({ message: "Slot is full or no longer available" });
				return;
			}

			// Resolve concrete slot for the new booking date
			const concreteSlot = await resolveConcreteSlotForBooking(
				requestedSlot,
				newDate,
			);

			if (!concreteSlot) {
				res
					.status(409)
					.json({ message: "Slot is full or no longer available" });
				return;
			}

			rescheduleConcreteSlot = {
				startTime: concreteSlot.startTime,
				endTime: concreteSlot.endTime,
			};

			const shouldReserveSlot =
				newSlotId !== existingBooking.slot.toString();

			if (shouldReserveSlot) {
				// Reserve the new slot
				const reservedSlot = await reserveSlotCapacity(
					concreteSlot._id.toString(),
				);

				if (!reservedSlot) {
					res
						.status(409)
						.json({ message: "Slot is full or no longer available" });
					return;
				}

				newReservedSlotId = reservedSlot._id.toString();
			}

			// Release the old slot when switching to a different slot
			if (newSlotId !== existingBooking.slot.toString()) {
				await releaseSlotCapacity(existingBooking.slot.toString());
			}
		}

		// Update the booking
		const updatePayload: Record<string, unknown> = {};

		if (bookingDate) {
			updatePayload.bookingDate = bookingDate;
		}

		if (slotId && newReservedSlotId) {
			updatePayload.slot = newReservedSlotId;
		} else if (slotId) {
			updatePayload.slot = slotId;
		}

		if (serviceId) {
			updatePayload.service = serviceId;
		}

		if (reportId) {
			updatePayload.report = reportId;
		}

		if (rescheduleConcreteSlot) {
			updatePayload.startTime = rescheduleConcreteSlot.startTime;
			updatePayload.endTime = rescheduleConcreteSlot.endTime;
		}

		const updatedBooking = await Booking.findOneAndUpdate(
			{ _id: id, status: nonCancelledBookingStatusFilter },
			updatePayload,
			{
			returnDocument: "after",
			runValidators: true,
			},
		);

		if (!updatedBooking) {
			// Rollback: release the newly reserved slot if update failed
			if (newReservedSlotId) {
				await releaseSlotCapacity(newReservedSlotId).catch(() => null);
			}

			const latestBooking = await Booking.findById(id);
			if (!latestBooking) {
				res.status(404).json({ message: "Booking not found" });
				return;
			}

			if (isCancelledBookingStatus(latestBooking.status)) {
				res.status(409).json({
					message:
						"Cancelled bookings are immutable and cannot be updated or rescheduled",
				});
				return;
			}

			res.status(404).json({ message: "Booking not found" });
			return;
		}

		res
			.status(200)
			.json({ message: "Booking updated", booking: updatedBooking });
	} catch (error) {
		// Rollback: release the newly reserved slot on error
		if (newReservedSlotId) {
			await releaseSlotCapacity(newReservedSlotId).catch(() => null);
		}

		next(error);
	}
};

export const deleteBookingById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid booking id" });
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		const session = await mongoose.startSession();
		try {
			let response: { status: number; body: Record<string, unknown> } | null =
				null;

			await session.withTransaction(async () => {
				const existingBooking = await Booking.findById(id).session(session);

				if (!existingBooking) {
					response = {
						status: 404,
						body: { message: "Booking not found" },
					};
					return;
				}

				if (!isCancelledBookingStatus(existingBooking.status)) {
					const transitionedBooking = await Booking.findOneAndUpdate(
						{ _id: id, status: nonCancelledBookingStatusFilter },
						{ status: BookingStatus.Cancelled },
						{ returnDocument: "after", runValidators: true, session },
					);

					if (transitionedBooking) {
						await releaseSlotCapacity(
							transitionedBooking.slot.toString(),
							session,
						);

						await refundCreditsBySource({
							userId: transitionedBooking.user.toString(),
							sourceType: CreditTransactionSource.Booking,
							sourceId: transitionedBooking._id.toString(),
							actorId: requester.id,
							actorRole: requester.role,
							reason: `Booking ${transitionedBooking._id.toString()} deleted`,
							session,
						});
					}
				}

				const deletedBooking = await Booking.findByIdAndDelete(id, {
					session,
				});

				if (!deletedBooking) {
					response = {
						status: 404,
						body: { message: "Booking not found" },
					};
					return;
				}

				response = { status: 200, body: { message: "Booking deleted" } };
			});

			if (response) {
				res.status(response.status).json(response.body);
				return;
			}

			res.status(500).json({ message: "Booking delete failed" });
		} finally {
			session.endSession();
		}
	} catch (error) {
		next(error);
	}
};

export const changeBookingStatus: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid booking id" });
		return;
	}

	const parsedBody = changeBookingStatusBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid booking status payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		if (isCancelledBookingStatus(parsedBody.data.status)) {
			const session = await mongoose.startSession();
			try {
				let response: { status: number; body: Record<string, unknown> } | null =
					null;

				await session.withTransaction(async () => {
					const transitionedBooking = await Booking.findOneAndUpdate(
						{ _id: id, status: nonCancelledBookingStatusFilter },
						{ status: BookingStatus.Cancelled },
						{ returnDocument: "after", runValidators: true, session },
					);

					if (!transitionedBooking) {
						const existingBooking = await Booking.findById(id).session(session);

						if (!existingBooking) {
							response = {
								status: 404,
								body: { message: "Booking not found" },
							};
							return;
						}

						response = {
							status: 200,
							body: {
								message: "Booking status changed",
								booking: existingBooking,
								credits: { refunded: 0 },
							},
						};
						return;
					}

					await releaseSlotCapacity(
						transitionedBooking.slot.toString(),
						session,
					);

					const refundResult = await refundCreditsBySource({
						userId: transitionedBooking.user.toString(),
						sourceType: CreditTransactionSource.Booking,
						sourceId: transitionedBooking._id.toString(),
						actorId: requester.id,
						actorRole: requester.role,
						reason: `Booking ${transitionedBooking._id.toString()} cancelled`,
						session,
					});

					response = {
						status: 200,
						body: {
							message: "Booking status changed",
							booking: transitionedBooking,
							credits: { refunded: refundResult.refunded },
						},
					};
				});

				if (response) {
					res.status(response.status).json(response.body);
					return;
				}

				res.status(500).json({ message: "Booking cancellation failed" });
				return;
			} finally {
				session.endSession();
			}
		}

		const booking = await Booking.findOneAndUpdate(
			{ _id: id, status: nonCancelledBookingStatusFilter },
			{ status: parsedBody.data.status },
			{ returnDocument: "after", runValidators: true },
		);

		if (!booking) {
			const existingBooking = await Booking.findById(id);
			if (!existingBooking) {
				res.status(404).json({ message: "Booking not found" });
				return;
			}

			if (isCancelledBookingStatus(existingBooking.status)) {
				res.status(409).json({
					message:
						"Cancelled bookings are immutable and cannot be updated or reactivated",
				});
				return;
			}

			res.status(404).json({ message: "Booking not found" });
			return;
		}

		res.status(200).json({
			message: "Booking status changed",
			booking,
			credits: { refunded: 0 },
		});
	} catch (error) {
		next(error);
	}
};
