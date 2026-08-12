import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Admin from "../models/Admin";
import { hashPassword } from "../utils/password";
import { isEmailInUseAcrossSystem } from "../utils/email-uniqueness";
import {
	createAdminBodySchema,
	updateAdminBodySchema,
} from "../validators/admin.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

export const createAdmin: RequestHandler = async (req, res, next) => {
	const parsedBody = createAdminBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid admin payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { adminName, email, phone, password } = parsedBody.data;

	try {
		const passwordHash = await hashPassword(password);

		const emailCheck = await isEmailInUseAcrossSystem(email);
		if (emailCheck.exists) {
			res.status(409).json({ message: `An account with this email already exists as a ${emailCheck.accountType}` });
			return;
		}

		const admin = await Admin.create({
			adminName,
			email,
			phone,
			passwordHash,
		});

		res.status(201).json({ message: "Admin created", admin });
	} catch (error) {
		next(error);
	}
};

export const getAllAdmins: RequestHandler = async (_req, res, next) => {
	try {
		const admins = await Admin.find();
		res.status(200).json({ admins });
	} catch (error) {
		next(error);
	}
};

export const getAdminById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	try {
		const admin = await Admin.findById(id);

		if (!admin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		res.status(200).json({ admin });
	} catch (error) {
		next(error);
	}
};

export const updateAdminById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	const parsedBody = updateAdminBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid admin update payload",
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
		if (rest.email) {
			const emailCheck = await isEmailInUseAcrossSystem(rest.email, id);
			if (emailCheck.exists) {
				res.status(409).json({ message: `An account with this email already exists as a ${emailCheck.accountType}` });
				return;
			}
		}

		const updatedAdmin = await Admin.findByIdAndUpdate(id, updatePayload, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedAdmin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		res.status(200).json({ message: "Admin updated", admin: updatedAdmin });
	} catch (error) {
		next(error);
	}
};

export const deleteAdminById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid admin id" });
		return;
	}

	try {
		const deletedAdmin = await Admin.findByIdAndDelete(id);

		if (!deletedAdmin) {
			res.status(404).json({ message: "Admin not found" });
			return;
		}

		res.status(200).json({ message: "Admin deleted" });
	} catch (error) {
		next(error);
	}
};
