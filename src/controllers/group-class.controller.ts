import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Service, { ServiceType } from "../models/Service";
import {
	createGroupClassBodySchema,
	updateGroupClassBodySchema,
} from "../validators/group-class.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

const areValidObjectIds = (ids: string[]): boolean =>
	ids.every((id) => mongoose.Types.ObjectId.isValid(id));

const toGroupClassResponse = (doc: any) => ({
	_id: doc._id,
	id: String(doc._id),
	name: doc.serviceName,
	description: doc.description,
	mode: doc.mode ?? "offline",
	instructor: doc.instructor ?? "",
	durationMinutes: doc.serviceTime,
	creditsRequired: doc.creditCost ?? 1,
	maxParticipants: doc.maxParticipants ?? 20,
	tags: doc.tags ?? [],
	scheduleInfo: doc.scheduleInfo ?? "",
	isActive: doc.isActive ?? true,
	slots: (doc.slots ?? []).map((s: any) =>
		String(s?._id ?? s)
	),
	createdAt: doc.createdAt,
	updatedAt: doc.updatedAt,
});

export const getAllGroupClasses: RequestHandler = async (_req, res, next) => {
	try {
		const classes = await Service.find({ serviceType: ServiceType.GroupClass });
		res.status(200).json({ groupClasses: classes.map(toGroupClassResponse) });
	} catch (error) {
		next(error);
	}
};

export const getGroupClassById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid group class id" });
		return;
	}

	try {
		const gc = await Service.findOne({
			_id: id,
			serviceType: ServiceType.GroupClass,
		});

		if (!gc) {
			res.status(404).json({ message: "Group class not found" });
			return;
		}

		res.status(200).json({ groupClass: toGroupClassResponse(gc) });
	} catch (error) {
		next(error);
	}
};

export const createGroupClass: RequestHandler = async (req, res, next) => {
	const parsed = createGroupClassBodySchema.safeParse(req.body);

	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid group class payload",
			errors: parsed.error.issues,
		});
		return;
	}

	if (!areValidObjectIds(parsed.data.slots)) {
		res.status(400).json({ message: "Invalid slot references" });
		return;
	}

	try {
		const gc = await Service.create({
			serviceType: ServiceType.GroupClass,
			serviceName: parsed.data.name,
			serviceTime: parsed.data.durationMinutes,
			creditCost: parsed.data.creditsRequired,
			description: parsed.data.description,
			tags: parsed.data.tags,
			slots: parsed.data.slots,
			mode: parsed.data.mode,
			instructor: parsed.data.instructor,
			maxParticipants: parsed.data.maxParticipants,
			scheduleInfo: parsed.data.scheduleInfo,
			isActive: parsed.data.isActive,
		});

		res.status(201).json({
			message: "Group class created",
			groupClass: toGroupClassResponse(gc),
		});
	} catch (error) {
		next(error);
	}
};

export const updateGroupClassById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid group class id" });
		return;
	}

	const parsed = updateGroupClassBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid group class update payload",
			errors: parsed.error.issues,
		});
		return;
	}

	if (parsed.data.slots && !areValidObjectIds(parsed.data.slots)) {
		res.status(400).json({ message: "Invalid slot references" });
		return;
	}

	const {
		name,
		description,
		mode,
		instructor,
		durationMinutes,
		creditsRequired,
		maxParticipants,
		tags,
		scheduleInfo,
		slots,
		isActive,
	} = parsed.data;

	const updateDoc: Record<string, unknown> = {};
	if (name !== undefined) updateDoc.serviceName = name;
	if (description !== undefined) updateDoc.description = description;
	if (mode !== undefined) updateDoc.mode = mode;
	if (instructor !== undefined) updateDoc.instructor = instructor;
	if (durationMinutes !== undefined) updateDoc.serviceTime = durationMinutes;
	if (creditsRequired !== undefined) updateDoc.creditCost = creditsRequired;
	if (maxParticipants !== undefined) updateDoc.maxParticipants = maxParticipants;
	if (tags !== undefined) updateDoc.tags = tags;
	if (scheduleInfo !== undefined) updateDoc.scheduleInfo = scheduleInfo;
	if (slots !== undefined) updateDoc.slots = slots;
	if (isActive !== undefined) updateDoc.isActive = isActive;

	try {
		const updated = await Service.findOneAndUpdate(
			{ _id: id, serviceType: ServiceType.GroupClass },
			updateDoc,
			{ returnDocument: "after", runValidators: true }
		);

		if (!updated) {
			res.status(404).json({ message: "Group class not found" });
			return;
		}

		res.status(200).json({
			message: "Group class updated",
			groupClass: toGroupClassResponse(updated),
		});
	} catch (error) {
		next(error);
	}
};

export const deleteGroupClassById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid group class id" });
		return;
	}

	try {
		const deleted = await Service.findOneAndDelete({
			_id: id,
			serviceType: ServiceType.GroupClass,
		});

		if (!deleted) {
			res.status(404).json({ message: "Group class not found" });
			return;
		}

		res.status(200).json({ message: "Group class deleted" });
	} catch (error) {
		next(error);
	}
};
