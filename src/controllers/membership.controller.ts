import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Membership from "../models/Membership";
import {
	createMembershipBodySchema,
	updateMembershipBodySchema,
} from "../validators/membership.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const parseDateOrNull = (value: string | undefined): Date | null => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const requireAuthenticatedUser = (
	req: Parameters<RequestHandler>[0],
): typeof req.user | null => {
	if (!req.user) {
		return null;
	}

	return req.user;
};

export const createMembership: RequestHandler = async (req, res, next) => {
	const parsedBody = createMembershipBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid membership payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = requireAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	if (requester.role !== "admin") {
		res.status(403).json({ message: "Only admins can create memberships" });
		return;
	}

	const { userId, startDate, endDate, creditsIncluded, ...rest } =
		parsedBody.data;

	if (!userId) {
		res.status(400).json({ message: "userId is required" });
		return;
	}

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	const startDateValue = parseDateOrNull(startDate);
	const endDateValue = parseDateOrNull(endDate);

	if (!startDateValue) {
		res.status(400).json({ message: "Invalid startDate" });
		return;
	}

	if (endDate && !endDateValue) {
		res.status(400).json({ message: "Invalid endDate" });
		return;
	}

	if (startDateValue && endDateValue && endDateValue < startDateValue) {
		res.status(400).json({ message: "endDate cannot be before startDate" });
		return;
	}

	try {
		const membership = await Membership.create({
			...rest,
			status: rest.status as
				| import("../models/Enums").MembershipStatus
				| undefined,
			creditsIncluded,
			creditsRemaining: creditsIncluded,
			user: userId,
			startDate: startDateValue,
			...(endDateValue ? { endDate: endDateValue } : {}),
		});

		res.status(201).json({ message: "Membership created", membership });
	} catch (error) {
		next(error);
	}
};

export const getAllMemberships: RequestHandler = async (req, res, next) => {
	try {
		const userIdRaw = req.query.userId;
		const filter: Record<string, unknown> = {};
		if (typeof userIdRaw === "string" && userIdRaw.length > 0) {
			const userId = getIdParam(userIdRaw);
			if (!userId) {
				res.status(400).json({ error: "Invalid userId", code: "BAD_REQUEST" });
				return;
			}
			filter.user = userId;
		}
		const memberships = await Membership.find(filter);
		res.status(200).json({ memberships });
	} catch (error) {
		next(error);
	}
};

export const getMembershipById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid membership id" });
		return;
	}

	try {
		const membership = await Membership.findById(id);

		if (!membership) {
			res.status(404).json({ message: "Membership not found" });
			return;
		}

		res.status(200).json({ membership });
	} catch (error) {
		next(error);
	}
};

export const getMyMemberships: RequestHandler = async (req, res, next) => {
	const requester = requireAuthenticatedUser(req);

	if (!requester || requester.role !== "user") {
		res.status(403).json({ message: "Only users can access this endpoint" });
		return;
	}

	try {
		const memberships = await Membership.find({ user: requester.id });
		res.status(200).json({ memberships });
	} catch (error) {
		next(error);
	}
};

export const updateMembershipById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid membership id" });
		return;
	}

	const parsedBody = updateMembershipBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid membership update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { userId, startDate, endDate, creditsIncluded, ...rest } =
		parsedBody.data;

	if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	const startDateValue = startDate ? parseDateOrNull(startDate) : null;
	const endDateValue = endDate ? parseDateOrNull(endDate) : null;

	if (startDate && !startDateValue) {
		res.status(400).json({ message: "Invalid startDate" });
		return;
	}

	if (endDate && !endDateValue) {
		res.status(400).json({ message: "Invalid endDate" });
		return;
	}

	if (startDateValue && endDateValue && endDateValue < startDateValue) {
		res.status(400).json({ message: "endDate cannot be before startDate" });
		return;
	}

	try {
		const existingMembership = await Membership.findById(id).select(
			"_id creditsIncluded creditsRemaining",
		);

		if (!existingMembership) {
			res.status(404).json({ message: "Membership not found" });
			return;
		}

		const updatePayload: Record<string, unknown> = {
			...(userId ? { user: userId } : {}),
			...(startDateValue ? { startDate: startDateValue } : {}),
			...(endDateValue ? { endDate: endDateValue } : {}),
			...rest,
		};

		if (typeof creditsIncluded === "number") {
			const includedDelta =
				creditsIncluded - (existingMembership.creditsIncluded ?? 0);
			updatePayload.creditsIncluded = creditsIncluded;
			updatePayload.creditsRemaining = Math.max(
				0,
				(existingMembership.creditsRemaining ?? 0) + includedDelta,
			);
		}

		const updatedMembership = await Membership.findByIdAndUpdate(
			id,
			updatePayload,
			{ returnDocument: "after", runValidators: true },
		);

		if (!updatedMembership) {
			res.status(404).json({ message: "Membership not found" });
			return;
		}

		res
			.status(200)
			.json({ message: "Membership updated", membership: updatedMembership });
	} catch (error) {
		next(error);
	}
};

export const deleteMembershipById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid membership id" });
		return;
	}

	try {
		const deletedMembership = await Membership.findByIdAndDelete(id);

		if (!deletedMembership) {
			res.status(404).json({ message: "Membership not found" });
			return;
		}

		res.status(200).json({ message: "Membership deleted" });
	} catch (error) {
		next(error);
	}
};
