import mongoose from "mongoose";

const conferenceSettingsSchema = new mongoose.Schema(
	{
		defaultVideoResolution: {
			type: String,
			enum: ["360p", "540p", "720p", "1080p"],
			default: "720p",
			required: true,
		},
		defaultFrameRate: {
			type: Number,
			enum: [15, 30, 60],
			default: 30,
			required: true,
		},
		defaultAudioMode: {
			type: String,
			enum: ["mono", "stereo"],
			default: "stereo",
			required: true,
		},
		maxParticipantsPerSession: {
			type: Number,
			min: 1,
			max: 500,
			default: 50,
			required: true,
		},
		layoutTemplates: {
			type: [String],
			default: ["interactive_class", "large_event", "standard_meeting"],
			required: true,
		},
	},
	{ timestamps: true },
);

type ConferenceSettingsDocument = mongoose.InferSchemaType<
	typeof conferenceSettingsSchema
>;

export default (mongoose.models.ConferenceSettings as mongoose.Model<ConferenceSettingsDocument>) ||
	mongoose.model<ConferenceSettingsDocument>(
		"ConferenceSettings",
		conferenceSettingsSchema,
	);
