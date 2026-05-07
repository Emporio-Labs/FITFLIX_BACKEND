import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Appointment from "../models/Appointment";
import Doctor from "../models/Doctor";
import { BookingStatus, CreditTransactionSource } from "../models/Enums";
import Service from "../models/Service";
import Slot from "../models/Slots";
import type { AuthenticatedUser } from "../types/auth";
import {
	CreditServiceError,
	consumeCredits,
	refundCreditsBySource,
} from "../utils/credit.service";
import {
	changeAppointmentStatusBodySchema,
	createAppointmentBodySchema,
	updateAppointmentBodySchema,
} from "../validators/appointment.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const getRequiredAuthenticatedUser = (
	req: Parameters<RequestHandler>[0] & { user?: AuthenticatedUser },
) => {
	if (!req.user) {
		return null;
	}

	return req.user;
};

const getDoctorIdForRequester = async (
	requesterId: string,
): Promise<string | null> => {
	const doctor = await Doctor.findOne({ _id: requesterId }).select("_id");
	if (!doctor) {
		return null;
	}

	return doctor._id.toString();
};

const isCancelledAppointmentStatus = (status: unknown): boolean =>
	status === BookingStatus.Cancelled ||
	status === String(BookingStatus.Cancelled) ||
	status === "Cancelled";

const nonCancelledAppointmentStatusFilter = {
	$nin: [BookingStatus.Cancelled, String(BookingStatus.Cancelled), "Cancelled"],
};

const mapCreditServiceError = (
	error: CreditServiceError,
): { status: number; message: string } => {
	switch (error.code) {
		case "NO_ACTIVE_MEMBERSHIP":
			return {
				status: 403,
				message: "No active membership with available credits",
			};
		case "INSUFFICIENT_CREDITS":
			return { status: 402, message: "Insufficient credits" };
		default:
			return { status: 400, message: error.message };
	}
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

const resolveConcreteSlotForAppointment = async (
	slot: {
		_id: mongoose.Types.ObjectId;
		date?: Date | null;
		isDaily?: boolean;
		startTime: string;
		endTime: string;
		capacity?: number;
		parentTemplate?: mongoose.Types.ObjectId | null;
	},
	appointmentDate: Date,
) => {
	const appointmentDay = normalizeToUtcDate(appointmentDate);

	if (slot.parentTemplate) {
		if (!slot.date || !isSameUtcDate(slot.date, appointmentDay)) {
			return null;
		}

		return slot;
	}

	if (slot.isDaily) {
		const templateCapacity = Math.max(1, Number(slot.capacity ?? 1));

		const concreteSlot = await Slot.findOneAndUpdate(
			{
				parentTemplate: slot._id,
				date: appointmentDay,
				startTime: slot.startTime,
				endTime: slot.endTime,
			},
			{
				$setOnInsert: {
					date: appointmentDay,
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

	if (!slot.date || !isSameUtcDate(slot.date, appointmentDay)) {
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

export const createAppointment: RequestHandler = async (req, res, next) => {
	const parsedBody = createAppointmentBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid appointment payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const {
		appointmentDate,
		userId,
		slotId,
		doctorId,
		serviceId,
		reportId,
		bypassCredits,
	} = parsedBody.data;

	if (
		!mongoose.Types.ObjectId.isValid(userId) ||
		!mongoose.Types.ObjectId.isValid(slotId) ||
		!mongoose.Types.ObjectId.isValid(doctorId) ||
		(serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) ||
		(reportId && !mongoose.Types.ObjectId.isValid(reportId))
	) {
		res.status(400).json({ message: "Invalid appointment references" });
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
		let creditCost = 1;
		let serviceSlots: Array<mongoose.Types.ObjectId> | undefined;

		if (serviceId) {
			const service = await Service.findById(serviceId).select(
				"_id creditCost slots",
			);

			if (!service) {
				res.status(404).json({ message: "Service not found" });
				return;
			}

			creditCost = Math.max(1, Number(service.creditCost ?? 1));
			serviceSlots = service.slots;
		}

		const requestedSlot = await Slot.findById(slotId).select(
			"_id date isDaily startTime endTime capacity remainingCapacity isBooked parentTemplate",
		);

		if (!requestedSlot) {
			res.status(409).json({ message: "Slot is full or no longer available" });
			return;
		}

		if (serviceSlots && !isSlotLinkedToService(serviceSlots, requestedSlot)) {
			res.status(409).json({ message: "Slot is full or no longer available" });
			return;
		}

		const concreteSlot = await resolveConcreteSlotForAppointment(
			requestedSlot,
			appointmentDate,
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

		const appointment = await Appointment.create({
			appointmentDate,
			startTime: concreteSlot.startTime,
			endTime: concreteSlot.endTime,
			user: userId,
			slot: concreteReservedSlotId,
			doctor: doctorId,
			creditCostSnapshot: creditCost,
			creditsBypassed: bypassCredits,
			...(serviceId ? { service: serviceId } : {}),
			...(reportId ? { report: reportId } : {}),
		});

		if (!bypassCredits) {
			try {
				await consumeCredits({
					userId,
					amount: creditCost,
					sourceType: CreditTransactionSource.Appointment,
					sourceId: appointment._id.toString(),
					actorId: requester.id,
					actorRole: requester.role,
					reason: `Appointment ${appointment._id.toString()}`,
				});
			} catch (error) {
				await Appointment.findByIdAndDelete(appointment._id).catch(() => null);

				if (reservedSlotId) {
					await releaseSlotCapacity(reservedSlotId).catch(() => null);
					reservedSlotId = null;
				}

				if (error instanceof CreditServiceError) {
					const creditError = mapCreditServiceError(error);
					res.status(creditError.status).json({ message: creditError.message });
					return;
				}

				throw error;
			}
		}

		res.status(201).json({
			message: "Appointment created",
			appointment,
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

export const getAllAppointments: RequestHandler = async (_req, res, next) => {
	try {
		const appointments = await Appointment.find();
		res.status(200).json({ appointments });
	} catch (error) {
		next(error);
	}
};

export const getAppointmentById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid appointment id" });
		return;
	}

	try {
		const appointment = await Appointment.findById(id);

		if (!appointment) {
			res.status(404).json({ message: "Appointment not found" });
			return;
		}

		res.status(200).json({ appointment });
	} catch (error) {
		next(error);
	}
};

export const getMyAppointments: RequestHandler = async (req, res, next) => {
	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	if (requester.role !== "doctor") {
		res.status(403).json({ message: "Forbidden" });
		return;
	}

	try {
		const appointments = await Appointment.find({ doctor: requester.id });
		res.status(200).json({ appointments });
	} catch (error) {
		next(error);
	}
};

export const updateAppointmentById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid appointment id" });
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const parsedBody = updateAppointmentBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid appointment update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { appointmentDate, slotId, doctorId, serviceId, reportId } =
		parsedBody.data;

	if (
		(slotId && !mongoose.Types.ObjectId.isValid(slotId)) ||
		(doctorId && !mongoose.Types.ObjectId.isValid(doctorId)) ||
		(serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) ||
		(reportId && !mongoose.Types.ObjectId.isValid(reportId))
	) {
		res.status(400).json({ message: "Invalid appointment references" });
		return;
	}

	let newReservedSlotId: string | null = null;

	try {
		// Fetch the existing appointment
		const existingAppointment = await Appointment.findById(id);

		if (!existingAppointment) {
			res.status(404).json({ message: "Appointment not found" });
			return;
		}

		// Authorization check: users can only update their own appointments
		if (
			requester.role === "user" &&
			existingAppointment.user.toString() !== requester.id
		) {
			res.status(403).json({ message: "Forbidden" });
			return;
		}

		const wasCancelled = isCancelledAppointmentStatus(
			existingAppointment.status,
		);
		const shouldReschedule = Boolean(slotId || appointmentDate);
		let rebookCreditCost: number | null = null;
		let rescheduleConcreteSlot: { startTime: string; endTime: string } | null =
			null;

		// If slot or appointment date is being changed, handle the reschedule logic
		if (shouldReschedule) {
			const newSlotId = slotId || existingAppointment.slot.toString();
			const newDate = appointmentDate || existingAppointment.appointmentDate;

			// If no service is provided and existing appointment has a service, use it for validation
			let serviceIdForValidation = serviceId;
			if (!serviceIdForValidation && existingAppointment.service) {
				serviceIdForValidation = existingAppointment.service.toString();
			}

			// Fetch the service to validate the new slot (if a service is available)
			let service = null;
			if (serviceIdForValidation) {
				service = await Service.findById(serviceIdForValidation).select(
					"_id creditCost slots",
				);

				if (!service) {
					res.status(404).json({ message: "Service not found" });
					return;
				}
			}

			// Fetch the new slot
			const requestedSlot = await Slot.findById(newSlotId).select(
				"_id date isDaily startTime endTime capacity remainingCapacity isBooked parentTemplate",
			);

			if (!requestedSlot) {
				res
					.status(409)
					.json({ message: "Slot is full or no longer available" });
				return;
			}

			// Validate slot is linked to service if a service is available
			if (service && !isSlotLinkedToService(service.slots, requestedSlot)) {
				res
					.status(409)
					.json({ message: "Slot is full or no longer available" });
				return;
			}

			// Resolve concrete slot for the new appointment date
			const concreteSlot = await resolveConcreteSlotForAppointment(
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
				wasCancelled || newSlotId !== existingAppointment.slot.toString();

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
			if (newSlotId !== existingAppointment.slot.toString()) {
				await releaseSlotCapacity(existingAppointment.slot.toString());
			}

			if (wasCancelled) {
				const baseCreditCost = service
					? Number(service.creditCost ?? 1)
					: Number(existingAppointment.creditCostSnapshot ?? 1);
				rebookCreditCost = Math.max(1, baseCreditCost);

				if (!existingAppointment.creditsBypassed) {
					try {
						await consumeCredits({
							userId: existingAppointment.user.toString(),
							amount: rebookCreditCost,
							sourceType: CreditTransactionSource.Appointment,
							sourceId: existingAppointment._id.toString(),
							actorId: requester.id,
							actorRole: requester.role,
							reason: `Appointment ${existingAppointment._id.toString()} rescheduled`,
						});
					} catch (error) {
						if (newReservedSlotId) {
							await releaseSlotCapacity(newReservedSlotId).catch(() => null);
							newReservedSlotId = null;
						}

						if (error instanceof CreditServiceError) {
							const creditError = mapCreditServiceError(error);
							res
								.status(creditError.status)
								.json({ message: creditError.message });
							return;
						}

						throw error;
					}
				}
			}
		}

		// Update the appointment
		const updatePayload: Record<string, unknown> = {};

		if (appointmentDate) {
			updatePayload.appointmentDate = appointmentDate;
		}

		if (slotId && newReservedSlotId) {
			updatePayload.slot = newReservedSlotId;
		} else if (slotId) {
			updatePayload.slot = slotId;
		}

		if (doctorId) {
			updatePayload.doctor = doctorId;
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

		if (wasCancelled && shouldReschedule) {
			updatePayload.status = BookingStatus.Booked;
			if (rebookCreditCost !== null) {
				updatePayload.creditCostSnapshot = rebookCreditCost;
			}
		}

		const updatedAppointment = await Appointment.findByIdAndUpdate(
			id,
			updatePayload,
			{
				returnDocument: "after",
				runValidators: true,
			},
		);

		if (!updatedAppointment) {
			// Rollback: release the newly reserved slot if update failed
			if (newReservedSlotId) {
				await releaseSlotCapacity(newReservedSlotId).catch(() => null);
			}

			res.status(404).json({ message: "Appointment not found" });
			return;
		}

		res.status(200).json({
			message: "Appointment updated",
			appointment: updatedAppointment,
		});
	} catch (error) {
		// Rollback: release the newly reserved slot on error
		if (newReservedSlotId) {
			await releaseSlotCapacity(newReservedSlotId).catch(() => null);
		}

		next(error);
	}
};

export const deleteAppointmentById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid appointment id" });
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
			const response = await session.withTransaction(async () => {
				const existingAppointment =
					await Appointment.findById(id).session(session);

				if (!existingAppointment) {
					return {
						status: 404,
						body: { message: "Appointment not found" },
					};
				}

				if (!isCancelledAppointmentStatus(existingAppointment.status)) {
					const transitionedAppointment = await Appointment.findOneAndUpdate(
						{ _id: id, status: nonCancelledAppointmentStatusFilter },
						{ status: BookingStatus.Cancelled },
						{ returnDocument: "after", runValidators: true, session },
					);

					if (transitionedAppointment) {
						await releaseSlotCapacity(
							transitionedAppointment.slot.toString(),
							session,
						);

						await refundCreditsBySource({
							userId: transitionedAppointment.user.toString(),
							sourceType: CreditTransactionSource.Appointment,
							sourceId: transitionedAppointment._id.toString(),
							actorId: requester.id,
							actorRole: requester.role,
							reason: `Appointment ${transitionedAppointment._id.toString()} deleted`,
							session,
						});
					}
				}

				const deletedAppointment = await Appointment.findByIdAndDelete(id, {
					session,
				});

				if (!deletedAppointment) {
					return {
						status: 404,
						body: { message: "Appointment not found" },
					};
				}

				return { status: 200, body: { message: "Appointment deleted" } };
			});

			if (!response) {
				res.status(500).json({ message: "Appointment delete failed" });
				return;
			}

			res.status(response.status).json(response.body);
		} finally {
			session.endSession();
		}
	} catch (error) {
		next(error);
	}
};

export const changeAppointmentStatus: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid appointment id" });
		return;
	}

	const parsedBody = changeAppointmentStatusBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid appointment status payload",
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
		let requesterDoctorId: string | null = null;

		if (requester.role === "doctor") {
			requesterDoctorId = await getDoctorIdForRequester(requester.id);

			if (!requesterDoctorId) {
				res.status(403).json({ message: "Forbidden" });
				return;
			}
		}

		if (isCancelledAppointmentStatus(parsedBody.data.status)) {
			const session = await mongoose.startSession();
			try {
				const response = await session.withTransaction(async () => {
					const transitionedAppointment = await Appointment.findOneAndUpdate(
						{
							_id: id,
							status: nonCancelledAppointmentStatusFilter,
							...(requesterDoctorId ? { doctor: requesterDoctorId } : {}),
						},
						{ status: BookingStatus.Cancelled },
						{ returnDocument: "after", runValidators: true, session },
					);

					if (!transitionedAppointment) {
						const existingAppointment =
							await Appointment.findById(id).session(session);

						if (!existingAppointment) {
							return {
								status: 404,
								body: { message: "Appointment not found" },
							};
						}

						if (
							requesterDoctorId &&
							existingAppointment.doctor.toString() !== requesterDoctorId
						) {
							return {
								status: 403,
								body: { message: "Forbidden" },
							};
						}

						return {
							status: 200,
							body: {
								message: "Appointment status changed",
								appointment: existingAppointment,
								credits: { refunded: 0 },
							},
						};
					}

					await releaseSlotCapacity(
						transitionedAppointment.slot.toString(),
						session,
					);

					const refundResult = await refundCreditsBySource({
						userId: transitionedAppointment.user.toString(),
						sourceType: CreditTransactionSource.Appointment,
						sourceId: transitionedAppointment._id.toString(),
						actorId: requester.id,
						actorRole: requester.role,
						reason: `Appointment ${transitionedAppointment._id.toString()} cancelled`,
						session,
					});

					return {
						status: 200,
						body: {
							message: "Appointment status changed",
							appointment: transitionedAppointment,
							credits: { refunded: refundResult.refunded },
						},
					};
				});

				if (!response) {
					res.status(500).json({ message: "Appointment cancellation failed" });
					return;
				}

				res.status(response.status).json(response.body);
				return;
			} finally {
				session.endSession();
			}
		}

		const appointment = await Appointment.findOneAndUpdate(
			{
				_id: id,
				status: nonCancelledAppointmentStatusFilter,
				...(requesterDoctorId ? { doctor: requesterDoctorId } : {}),
			},
			{ status: parsedBody.data.status },
			{ returnDocument: "after", runValidators: true },
		);

		if (!appointment) {
			const existingAppointment = await Appointment.findById(id);

			if (!existingAppointment) {
				res.status(404).json({ message: "Appointment not found" });
				return;
			}

			if (
				requesterDoctorId &&
				existingAppointment.doctor.toString() !== requesterDoctorId
			) {
				res.status(403).json({ message: "Forbidden" });
				return;
			}

			if (isCancelledAppointmentStatus(existingAppointment.status)) {
				res.status(409).json({
					message:
						"Cancelled appointments cannot be reactivated. Reschedule to rebook.",
				});
				return;
			}

			res.status(403).json({ message: "Forbidden" });
			return;
		}

		res.status(200).json({
			message: "Appointment status changed",
			appointment,
			credits: { refunded: 0 },
		});
	} catch (error) {
		next(error);
	}
};
