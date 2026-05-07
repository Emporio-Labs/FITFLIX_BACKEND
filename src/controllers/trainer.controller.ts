import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Trainer from "../models/Trainer";
import { hashPassword } from "../utils/password";
import {
	createTrainerBodySchema,
	updateTrainerBodySchema,
} from "../validators/trainer.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const toPublicTrainerResponse = (trainer: {
	_id: mongoose.Types.ObjectId;
	trainerName: string;
	description: string;
	specialities: string[];
}) => ({
	_id: trainer._id,
	name: trainer.trainerName,
	description: trainer.description,
	specialities: trainer.specialities,
});

export const createTrainer: RequestHandler = async (req, res, next) => {
	const parsedBody = createTrainerBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid trainer payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const { password, ...rest } = parsedBody.data;
		const passwordHash = await hashPassword(password);
		const trainer = await Trainer.create({
			...rest,
			passwordHash,
		});
		res.status(201).json({ message: "Trainer created", trainer });
	} catch (error) {
		next(error);
	}
};

export const getAllTrainers: RequestHandler = async (_req, res, next) => {
	try {
		const trainers = await Trainer.find();
		res.status(200).json({ trainers });
	} catch (error) {
		next(error);
	}
};

export const getPublicTrainers: RequestHandler = async (_req, res, next) => {
	try {
		const trainers = await Trainer.find().select(
			"trainerName description specialities",
		);
		res
			.status(200)
			.json({ trainers: trainers.map(toPublicTrainerResponse) });
	} catch (error) {
		next(error);
	}
};

export const getTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	try {
		const trainer = await Trainer.findById(id);

		if (!trainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res.status(200).json({ trainer });
	} catch (error) {
		next(error);
	}
};

export const getPublicTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	try {
		const trainer = await Trainer.findById(id).select(
			"trainerName description specialities",
		);

		if (!trainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res.status(200).json({ trainer: toPublicTrainerResponse(trainer) });
	} catch (error) {
		next(error);
	}
};

export const updateTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	const parsedBody = updateTrainerBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid trainer update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { password, ...rest } = parsedBody.data;
	const hashedPassword = password ? await hashPassword(password) : null;
	const updatePayload = {
		...rest,
		...(hashedPassword ? { passwordHash: hashedPassword } : {}),
	};

	try {
		const updatedTrainer = await Trainer.findByIdAndUpdate(id, updatePayload, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedTrainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res
			.status(200)
			.json({ message: "Trainer updated", trainer: updatedTrainer });
	} catch (error) {
		next(error);
	}
};

export const deleteTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	try {
		const deletedTrainer = await Trainer.findByIdAndDelete(id);

		if (!deletedTrainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res.status(200).json({ message: "Trainer deleted" });
	} catch (error) {
		next(error);
	}
};
