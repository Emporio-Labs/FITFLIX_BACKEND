import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Service, { ServiceType } from "../models/Service";
import {
	createServiceBodySchema,
	updateServiceBodySchema,
} from "../validators/service.validator";

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

export const createService: RequestHandler = async (req, res, next) => {
	const parsedBody = createServiceBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid service payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	if (!areValidObjectIds(parsedBody.data.slots)) {
		res.status(400).json({ message: "Invalid slot references" });
		return;
	}

	try {
		const service = await Service.create({
			...parsedBody.data,
			serviceType: ServiceType.Service,
		});
		res.status(201).json({ message: "Service created", service });
	} catch (error) {
		next(error);
	}
};

export const getAllServices: RequestHandler = async (_req, res, next) => {
	try {
		const services = await Service.find({ serviceType: ServiceType.Service });
		res.status(200).json({ services });
	} catch (error) {
		next(error);
	}
};

export const getServiceById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid service id" });
		return;
	}

	try {
		const service = await Service.findOne({
			_id: id,
			serviceType: ServiceType.Service,
		});

		if (!service) {
			res.status(404).json({ message: "Service not found" });
			return;
		}

		res.status(200).json({ service });
	} catch (error) {
		next(error);
	}
};

export const updateServiceById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid service id" });
		return;
	}

	const parsedBody = updateServiceBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid service update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	if (parsedBody.data.slots && !areValidObjectIds(parsedBody.data.slots)) {
		res.status(400).json({ message: "Invalid slot references" });
		return;
	}

	try {
		const updatedService = await Service.findOneAndUpdate(
			{ _id: id, serviceType: ServiceType.Service },
			parsedBody.data,
			{
				returnDocument: "after",
				runValidators: true,
			},
		);

		if (!updatedService) {
			res.status(404).json({ message: "Service not found" });
			return;
		}

		res
			.status(200)
			.json({ message: "Service updated", service: updatedService });
	} catch (error) {
		next(error);
	}
};

export const deleteServiceById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid service id" });
		return;
	}

	try {
		const deletedService = await Service.findOneAndDelete({
			_id: id,
			serviceType: ServiceType.Service,
		});

		if (!deletedService) {
			res.status(404).json({ message: "Service not found" });
			return;
		}

		res.status(200).json({ message: "Service deleted" });
	} catch (error) {
		next(error);
	}
};
