import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Slot from "../models/Slots";
import {
	createSlotBodySchema,
	updateSlotBodySchema,
} from "../validators/slot.validator";
import { availableSlotsQuerySchema } from "../validators/nutritionist-booking.validator";

const normalizeToUtcDayStart = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const normalizeToUtcDayEnd = (value: Date): Date => {
	const start = normalizeToUtcDayStart(value);
	return new Date(start.getTime() + 24 * 60 * 60 * 1000);
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const deriveSlotState = (input: {
	date?: Date;
	isDaily?: boolean;
	capacity?: number;
	remainingCapacity?: number;
	isBooked?: boolean;
}) => {
	const isDaily = input.isDaily ?? !input.date;
	const capacity = input.capacity ?? 1;
	const remainingCapacity = input.remainingCapacity ?? capacity;

	return {
		date: isDaily ? null : input.date,
		isDaily,
		capacity,
		remainingCapacity,
		isBooked: remainingCapacity <= 0,
	};
};

export const createSlot: RequestHandler = async (req, res, next) => {
	const parsedBody = createSlotBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid slot payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const derivedState = deriveSlotState(parsedBody.data);

		if (!derivedState.isDaily && !derivedState.date) {
			res.status(400).json({
				message: "date is required when isDaily is false",
			});
			return;
		}

		if (derivedState.remainingCapacity > derivedState.capacity) {
			res.status(400).json({
				message: "remainingCapacity cannot exceed capacity",
			});
			return;
		}

		const slot = await Slot.create({
			date: derivedState.date,
			isDaily: derivedState.isDaily,
			startTime: parsedBody.data.startTime,
			endTime: parsedBody.data.endTime,
			capacity: derivedState.capacity,
			remainingCapacity: derivedState.remainingCapacity,
			isBooked: derivedState.isBooked,
		});
		res.status(201).json({ message: "Slot created", slot });
	} catch (error) {
		next(error);
	}
};

export const getAvailableSlots: RequestHandler = async (req, res, next) => {
	const parsed = availableSlotsQuerySchema.safeParse(req.query);

	if (!parsed.success) {
		const firstIssue = parsed.error.issues[0];
		res.status(400).json({
			error: "Invalid query parameter: date is required (YYYY-MM-DD)",
			code: "VALIDATION_ERROR",
			details: firstIssue
				? { [String(firstIssue.path[0] ?? "date")]: firstIssue.message }
				: { date: "Invalid date" },
		});
		return;
	}

	try {
		const dayStart = normalizeToUtcDayStart(parsed.data.date);
		const dayEnd = normalizeToUtcDayEnd(parsed.data.date);

		const concreteSlots = await Slot.find({
			date: { $gte: dayStart, $lt: dayEnd },
			remainingCapacity: { $gt: 0 },
			isBooked: false,
		})
			.select(
				"_id date startTime endTime capacity remainingCapacity parentTemplate",
			)
			.sort({ startTime: 1 });

		const allConcreteForDay = await Slot.find({
			date: { $gte: dayStart, $lt: dayEnd },
			parentTemplate: { $exists: true, $ne: null },
		}).select("parentTemplate startTime endTime");

		const templatesWithConcrete = new Set(
			allConcreteForDay.map(
				(s) =>
					`${s.parentTemplate?.toString() ?? ""}::${s.startTime}::${s.endTime}`,
			),
		);

		const dailyTemplates = await Slot.find({
			isDaily: true,
			parentTemplate: null,
			capacity: { $gt: 0 },
		})
			.select("_id startTime endTime capacity")
			.sort({ startTime: 1 });

		const templateRows = dailyTemplates
			.filter(
				(t) =>
					!templatesWithConcrete.has(
						`${t._id.toString()}::${t.startTime}::${t.endTime}`,
					),
			)
			.map((t) => ({
				slotId: t._id,
				date: dayStart,
				startTime: t.startTime,
				endTime: t.endTime,
				capacity: t.capacity,
				remainingCapacity: t.capacity,
			}));

		const concreteRows = concreteSlots.map((s) => ({
			slotId: s._id,
			date: s.date,
			startTime: s.startTime,
			endTime: s.endTime,
			capacity: s.capacity,
			remainingCapacity: s.remainingCapacity,
		}));

		const slots = [...concreteRows, ...templateRows].sort((a, b) =>
			a.startTime.localeCompare(b.startTime),
		);

		res.status(200).json({ date: dayStart, slots });
	} catch (error) {
		next(error);
	}
};

export const getAllSlots: RequestHandler = async (_req, res, next) => {
	try {
		const slots = await Slot.find();
		res.status(200).json({ slots });
	} catch (error) {
		next(error);
	}
};

export const getSlotById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid slot id" });
		return;
	}

	try {
		const slot = await Slot.findById(id);

		if (!slot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		res.status(200).json({ slot });
	} catch (error) {
		next(error);
	}
};

export const updateSlotById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid slot id" });
		return;
	}

	const parsedBody = updateSlotBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid slot update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const existingSlot = await Slot.findById(id);

		if (!existingSlot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		const effectiveDate =
			parsedBody.data.date !== undefined
				? parsedBody.data.date
				: (existingSlot.date ?? undefined);
		const effectiveIsDaily =
			parsedBody.data.isDaily ?? existingSlot.isDaily ?? !effectiveDate;
		const effectiveCapacity =
			parsedBody.data.capacity ?? existingSlot.capacity ?? 1;
		const effectiveRemainingCapacity =
			parsedBody.data.remainingCapacity ??
			existingSlot.remainingCapacity ??
			effectiveCapacity;

		if (!effectiveIsDaily && !effectiveDate) {
			res.status(400).json({
				message: "date is required when isDaily is false",
			});
			return;
		}

		if (effectiveRemainingCapacity > effectiveCapacity) {
			res.status(400).json({
				message: "remainingCapacity cannot exceed capacity",
			});
			return;
		}

		const updatedSlot = await Slot.findByIdAndUpdate(
			id,
			{
				...(parsedBody.data.date !== undefined
					? { date: effectiveIsDaily ? null : parsedBody.data.date }
					: {}),
				...(parsedBody.data.isDaily !== undefined
					? { isDaily: parsedBody.data.isDaily }
					: {}),
				...(parsedBody.data.startTime !== undefined
					? { startTime: parsedBody.data.startTime }
					: {}),
				...(parsedBody.data.endTime !== undefined
					? { endTime: parsedBody.data.endTime }
					: {}),
				...(parsedBody.data.capacity !== undefined
					? { capacity: parsedBody.data.capacity }
					: {}),
				...(parsedBody.data.remainingCapacity !== undefined
					? { remainingCapacity: parsedBody.data.remainingCapacity }
					: {}),
				isBooked: effectiveRemainingCapacity <= 0,
				...(effectiveIsDaily ? { date: null } : {}),
			},
			{
				returnDocument: "after",
				runValidators: true,
			},
		);

		if (!updatedSlot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		res.status(200).json({ message: "Slot updated", slot: updatedSlot });
	} catch (error) {
		next(error);
	}
};

export const deleteSlotById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid slot id" });
		return;
	}

	try {
		const deletedSlot = await Slot.findByIdAndDelete(id);

		if (!deletedSlot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		res.status(200).json({ message: "Slot deleted" });
	} catch (error) {
		next(error);
	}
};
