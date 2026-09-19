import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Service, { ServiceType } from "../models/Service";
import {
	respondToLocationError,
	resolveCatalogLocation,
	scopedLocationFilter,
} from "../utils/location-scope";
import {
	createTherapyBodySchema,
	updateTherapyBodySchema,
} from "../validators/therapy.validator";

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

const toTherapyResponse = (service: {
	_id: mongoose.Types.ObjectId;
	serviceName: string;
	serviceTime: number;
	description: string;
	tags: string[];
	slots: mongoose.Types.ObjectId[];
	creditCost?: number;
	createdAt?: Date;
	updatedAt?: Date;
}) => ({
	_id: service._id,
	therapyName: service.serviceName,
	therapyTime: service.serviceTime,
	description: service.description,
	tags: service.tags,
	slots: service.slots,
	creditCost: service.creditCost ?? 1,
	createdAt: service.createdAt,
	updatedAt: service.updatedAt,
});

const toPublicTherapyResponse = (service: {
	_id: mongoose.Types.ObjectId;
	serviceName: string;
	serviceTime: number;
	description: string;
	tags: string[];
}) => ({
	_id: service._id,
	therapyName: service.serviceName,
	therapyTime: service.serviceTime,
	description: service.description,
	tags: service.tags,
});

export const createTherapy: RequestHandler = async (req, res, next) => {
	const parsedBody = createTherapyBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid therapy payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	if (!areValidObjectIds(parsedBody.data.slots)) {
		res.status(400).json({ message: "Invalid slot references" });
		return;
	}

	try {
		// Null = offered at every branch. Only an explicit locationId narrows it.
		const locationId = await resolveCatalogLocation(req);

		const therapy = await Service.create({
			serviceType: ServiceType.Therapy,
			serviceName: parsedBody.data.therapyName,
			serviceTime: parsedBody.data.therapyTime,
			creditCost: parsedBody.data.creditCost,
			description: parsedBody.data.description,
			tags: parsedBody.data.tags,
			slots: parsedBody.data.slots,
			locationId,
		});

		res.status(201).json({
			message: "Therapy created",
			therapy: toTherapyResponse(therapy),
		});
	} catch (error) {
		if (respondToLocationError(error, res)) {
			return;
		}
		next(error);
	}
};

export const getAllTherapies: RequestHandler = async (req, res, next) => {
	try {
		const therapies = await Service.find({
			serviceType: ServiceType.Therapy,
			...scopedLocationFilter(req, { includeNull: true }),
		});
		res.status(200).json({ therapies: therapies.map(toTherapyResponse) });
	} catch (error) {
		if (respondToLocationError(error, res)) {
			return;
		}
		next(error);
	}
};

export const getPublicTherapies: RequestHandler = async (req, res, next) => {
	try {
		// Public browse: an unauthenticated caller has no scope, so this is a
		// plain branch filter when the storefront asks for one.
		const therapies = await Service.find({
			serviceType: ServiceType.Therapy,
			...scopedLocationFilter(req, { includeNull: true }),
		}).select("serviceName serviceTime description tags");

		res.status(200).json({
			therapies: therapies.map(toPublicTherapyResponse),
		});
	} catch (error) {
		if (respondToLocationError(error, res)) {
			return;
		}
		next(error);
	}
};

export const getTherapyById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid therapy id" });
		return;
	}

	try {
		const therapy = await Service.findOne({
			_id: id,
			serviceType: ServiceType.Therapy,
		});

		if (!therapy) {
			res.status(404).json({ message: "Therapy not found" });
			return;
		}

		res.status(200).json({ therapy: toTherapyResponse(therapy) });
	} catch (error) {
		next(error);
	}
};

export const getPublicTherapyById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid therapy id" });
		return;
	}

	try {
		const therapy = await Service.findOne({
			_id: id,
			serviceType: ServiceType.Therapy,
		}).select("serviceName serviceTime description tags");

		if (!therapy) {
			res.status(404).json({ message: "Therapy not found" });
			return;
		}

		res.status(200).json({ therapy: toPublicTherapyResponse(therapy) });
	} catch (error) {
		next(error);
	}
};

export const updateTherapyById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid therapy id" });
		return;
	}

	const parsedBody = updateTherapyBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid therapy update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	if (parsedBody.data.slots && !areValidObjectIds(parsedBody.data.slots)) {
		res.status(400).json({ message: "Invalid slot references" });
		return;
	}

	try {
		const updatedTherapy = await Service.findOneAndUpdate(
			{ _id: id, serviceType: ServiceType.Therapy },
			{
				...(parsedBody.data.therapyName
					? { serviceName: parsedBody.data.therapyName }
					: {}),
				...(parsedBody.data.therapyTime
					? { serviceTime: parsedBody.data.therapyTime }
					: {}),
				...(parsedBody.data.creditCost
					? { creditCost: parsedBody.data.creditCost }
					: {}),
				...(parsedBody.data.description
					? { description: parsedBody.data.description }
					: {}),
				...(parsedBody.data.tags ? { tags: parsedBody.data.tags } : {}),
				...(parsedBody.data.slots ? { slots: parsedBody.data.slots } : {}),
			},
			{
				returnDocument: "after",
				runValidators: true,
			},
		);

		if (!updatedTherapy) {
			res.status(404).json({ message: "Therapy not found" });
			return;
		}

		res.status(200).json({
			message: "Therapy updated",
			therapy: toTherapyResponse(updatedTherapy),
		});
	} catch (error) {
		next(error);
	}
};

export const deleteTherapyById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid therapy id" });
		return;
	}

	try {
		const deletedTherapy = await Service.findOneAndDelete({
			_id: id,
			serviceType: ServiceType.Therapy,
		});

		if (!deletedTherapy) {
			res.status(404).json({ message: "Therapy not found" });
			return;
		}

		res.status(200).json({ message: "Therapy deleted" });
	} catch (error) {
		next(error);
	}
};
