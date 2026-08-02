import type { RequestHandler } from "express";
import { z } from "zod";
import ConferenceSettings from "../models/ConferenceSettings";

const updateConferenceSettingsSchema = z.object({
	defaultVideoResolution: z.enum(["360p", "540p", "720p", "1080p"]).optional(),
	defaultFrameRate: z.enum([15, 30, 60]).optional(),
	defaultAudioMode: z.enum(["mono", "stereo"]).optional(),
	maxParticipantsPerSession: z.number().int().min(1).max(500).optional(),
	layoutTemplates: z.array(z.string().trim().min(1)).optional(),
});

export const getConferenceSettings: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		let settings = await ConferenceSettings.findOne();
		if (!settings) {
			settings = await ConferenceSettings.create({
				defaultVideoResolution: "720p",
				defaultFrameRate: 30,
				defaultAudioMode: "stereo",
				maxParticipantsPerSession: 50,
				layoutTemplates: ["interactive_class", "large_event", "standard_meeting"],
			});
		}
		res.status(200).json({
			message: "Conference settings retrieved successfully",
			settings,
		});
	} catch (error) {
		next(error);
	}
};

export const updateConferenceSettings: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const parsed = updateConferenceSettingsSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				message: "Validation failed for conference settings update",
				errors: parsed.error.issues,
			});
			return;
		}

		let settings = await ConferenceSettings.findOne();
		if (!settings) {
			settings = new ConferenceSettings(parsed.data);
		} else {
			Object.assign(settings, parsed.data);
		}

		await settings.save();

		res.status(200).json({
			message: "Conference settings updated successfully",
			settings,
		});
	} catch (error) {
		next(error);
	}
};
