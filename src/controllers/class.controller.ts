import type { RequestHandler } from "express";
import z from "zod";
import Class from "../models/Class";
import {
	createClassBodySchema,
	updateClassBodySchema,
} from "../validators/class.validator";

// Helper to validate UUID format
const isValidUuid = (id: string | undefined): boolean => {
	if (!id) return false;
	return z.string().uuid().safeParse(id).success;
};

export const createClass: RequestHandler = async (req, res, next) => {
	const parsedBody = createClassBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid class payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const newClass = await Class.create(parsedBody.data);
		res.status(201).json({ message: "Class created", class: newClass });
	} catch (error) {
		next(error);
	}
};

export const getAllClassesForAdmin: RequestHandler = async (
	_req,
	res,
	next,
) => {
	try {
		const classes = await Class.find().sort({ createdAt: -1 });
		res.status(200).json({ classes });
	} catch (error) {
		next(error);
	}
};

export const getActiveClassesForMembers: RequestHandler = async (
	_req,
	res,
	next,
) => {
	try {
		// Member-facing listing returns *only* active and published classes
		const classes = await Class.find({
			status: "ACTIVE",
			isPublished: { $ne: false },
		}).sort({
			createdAt: -1,
		});
		res.status(200).json({ classes });
	} catch (error) {
		next(error);
	}
};

export const getClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	try {
		const classDetail = await Class.findById(id);

		if (!classDetail) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		res.status(200).json({ class: classDetail });
	} catch (error) {
		next(error);
	}
};

export const updateClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	const parsedBody = updateClassBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid class update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const updatedClass = await Class.findByIdAndUpdate(id, parsedBody.data, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		res.status(200).json({ message: "Class updated", class: updatedClass });
	} catch (error) {
		next(error);
	}
};

export const softDeleteClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	try {
		const retiredClass = await Class.findByIdAndUpdate(
			id,
			{ status: "INACTIVE" },
			{ returnDocument: "after" },
		);

		if (!retiredClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		res.status(200).json({ message: "Class retired", class: retiredClass });
	} catch (error) {
		next(error);
	}
};

export const publishClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	const isPublished =
		req.body?.isPublished !== undefined
			? Boolean(req.body.isPublished)
			: req.body?.is_published !== undefined
				? Boolean(req.body.is_published)
				: true;

	try {
		const updatedClass = await Class.findByIdAndUpdate(
			id,
			{ isPublished, status: isPublished ? "ACTIVE" : "INACTIVE" },
			{ returnDocument: "after" },
		);

		if (!updatedClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		res.status(200).json({
			message: isPublished ? "Class published" : "Class unpublished",
			class: updatedClass,
		});
	} catch (error) {
		next(error);
	}
};
