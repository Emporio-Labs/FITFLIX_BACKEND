import type { RequestHandler } from "express";
import z from "zod";
import {
	generateRoomCredentials,
	getZegocloudConfig,
} from "../services/zegocloud.service";

const roomCredentialsSchema = z.object({
	conferenceID: z.string().trim().min(1, "conferenceID is required"),
	userName: z.string().trim().optional(),
});

export const getZegocloudConfigHandler: RequestHandler = (
	_req,
	res,
	_next,
) => {
	const config = getZegocloudConfig();
	res.status(200).json({
		message: "ZEGOCLOUD config retrieved successfully",
		config,
	});
};

export const getRoomCredentialsHandler: RequestHandler = (req, res, next) => {
	const parsed = roomCredentialsSchema.safeParse(req.body);

	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid room credentials payload",
			errors: parsed.error.issues,
		});
		return;
	}

	try {
		const userID = (req.user as any)?.id || (req.user as any)?.userId || "guest_user";
		const userEmail = (req.user as any)?.email;
		const defaultName = userEmail ? userEmail.split("@")[0] : undefined;

		const credentials = generateRoomCredentials({
			conferenceID: parsed.data.conferenceID,
			userID,
			userName: parsed.data.userName || defaultName,
		});

		res.status(200).json({
			message: "Room credentials generated successfully",
			credentials,
		});
	} catch (error) {
		next(error);
	}
};
