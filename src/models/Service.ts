import mongoose from "mongoose";

export const ServiceType = {
	Service: "Service",
	Therapy: "Therapy",
	GroupClass: "GroupClass",
} as const;

export type ServiceTypeValue = (typeof ServiceType)[keyof typeof ServiceType];

const serviceSchema = new mongoose.Schema(
	{
		serviceType: {
			type: String,
			enum: Object.values(ServiceType),
			default: ServiceType.Service,
			required: true,
			index: true,
		},
		serviceName: { type: String, required: true },
		serviceTime: { type: Number, required: true },
		creditCost: { type: Number, required: true, min: 1, default: 1 },
		description: { type: String, required: true },
		tags: { type: [String], default: [] },
		slots: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Slot",
				required: true,
			},
		],
		// Group-class-specific fields (only populated when serviceType === 'GroupClass')
		mode: { type: String, enum: ["online", "offline", "hybrid"], default: null },
		instructor: { type: String, default: null },
		maxParticipants: { type: Number, default: null },
		scheduleInfo: { type: String, default: "" },
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

type ServiceDocument = mongoose.InferSchemaType<typeof serviceSchema>;

export default (mongoose.models.Service as mongoose.Model<ServiceDocument>) ||
	mongoose.model<ServiceDocument>("Service", serviceSchema);
