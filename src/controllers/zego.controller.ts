import type { RequestHandler } from "express";
import { generateToken04 } from "../utils/zego";

export const generateToken: RequestHandler = async (req, res, next) => {
	try {
		const { conferenceId } = req.body;

		if (!conferenceId || typeof conferenceId !== "string" || conferenceId.trim() === "") {
			res.status(400).json({ message: "conferenceId is required and must be a non-empty string" });
			return;
		}

		const appIDStr = process.env.ZEGO_APP_ID;
		const serverSecret = process.env.ZEGO_SERVER_SECRET;

		if (!appIDStr || !serverSecret) {
			res.status(503).json({
				message: "ZEGOCLOUD token service is not configured on this server.",
			});
			return;
		}

		const appID = Number(appIDStr);
		if (Number.isNaN(appID)) {
			res.status(500).json({ message: "Invalid ZEGO_APP_ID configuration" });
			return;
		}

		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		// Token validity: 2 hours (7200 seconds)
		const effectiveTimeInSeconds = 7200;

		// Restrict access specifically to the requested conference room and allow stream publish/login
		const payloadObj = {
			room_id: conferenceId,
			privilege: {
				1: 1, // privilegeLoginRoom: login room
				2: 1, // privilegePublishStream: publish stream
			},
		};
		const payload = JSON.stringify(payloadObj);

		const token = generateToken04(
			appID,
			user.id,
			serverSecret,
			effectiveTimeInSeconds,
			payload,
		);

		const expiresAt = new Date(Date.now() + effectiveTimeInSeconds * 1000).toISOString();

		res.status(200).json({ token, expiresAt });
	} catch (error) {
		console.error("Zego token generation error:", error);
		next(error);
	}
};
