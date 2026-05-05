import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Slot from "../models/Slots";
import {
	createSlotBodySchema,
	updateSlotBodySchema,
} from "../validators/slot.validator";

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
