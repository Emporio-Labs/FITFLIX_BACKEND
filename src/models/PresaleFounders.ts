import mongoose from "mongoose";

const encryptedTokenSchema = new mongoose.Schema({ iv: { type: String, required: true }, tag: { type: String, required: true }, ciphertext: { type: String, required: true } }, { _id: false });
const applicationSchema = new mongoose.Schema({
 _id: { type: String, required: true }, requestId: { type: String, required: true, unique: true, index: true }, payloadHash: { type: String, required: true }, tokenHash: { type: String, required: true, index: true }, encryptedToken: { type: encryptedTokenSchema, required: true }, answers: { type: mongoose.Schema.Types.Mixed, required: true }, contact: { type: mongoose.Schema.Types.Mixed, required: true }, consents: { type: mongoose.Schema.Types.Mixed, required: true }, attribution: { type: mongoose.Schema.Types.Mixed, required: true }, route: { type: String, enum: ["founder", "concierge", "explore"], required: true }, readinessRoute: { type: String, enum: ["founder", "concierge", "explore"], required: true }, fitScore: { type: Number, required: true }, brief: { type: mongoose.Schema.Types.Mixed, required: true }, summaryMode: { type: String, enum: ["structured"], default: "structured" }, status: { type: String, enum: ["new", "contacted", "qualified", "confirmed", "closed"], default: "new", index: true }, bookingStatus: { type: String, enum: ["not_applicable", "available", "requested"], default: "not_applicable" }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } }, { _id: false, versionKey: false });
applicationSchema.index({ "contact.email": 1 });
applicationSchema.index({ createdAt: -1 });

const settingsSchema = new mongoose.Schema({ _id: { type: String, default: "founders-club" }, confirmedMembers: { type: Number, default: null, min: 0, max: 100 }, deadline: { type: Date, default: null }, bookingUrl: { type: String, default: null }, founderName: { type: String, required: true, default: "FitFlix Founder" }, applicationOpen: { type: Boolean, required: true, default: true }, presaleNote: { type: String, default: "" }, metaPixelId: { type: String, default: null }, publicOrigin: { type: String, default: null }, updatedAt: { type: Date, default: Date.now } }, { _id: false, versionKey: false });

const callSlotSchema = new mongoose.Schema({ _id: { type: String, required: true }, startAt: { type: Date, required: true, index: true }, endAt: { type: Date, required: true }, capacity: { type: Number, required: true, min: 1, max: 1, default: 1 }, reservations: { type: [{ applicationId: String, reservedAt: Date }], default: [] }, status: { type: String, enum: ["open", "closed"], default: "open", index: true }, createdBy: { type: String, required: true }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } }, { _id: false, versionKey: false });
callSlotSchema.index({ startAt: 1, status: 1 });

const callRequestSchema = new mongoose.Schema({ _id: { type: String, required: true }, applicationId: { type: String, required: true, index: true }, slotId: { type: String, default: null, index: true }, preferredWindow: { type: String, default: null, maxlength: 200 }, kind: { type: String, enum: ["call", "tour"], required: true }, status: { type: String, enum: ["requested", "cancelled"], default: "requested" }, createdAt: { type: Date, default: Date.now } }, { _id: false, versionKey: false });
callRequestSchema.index({ applicationId: 1, kind: 1 }, { unique: true });

export type PresaleApplicationDocument = mongoose.InferSchemaType<typeof applicationSchema>;
export type PresaleSettingsDocument = mongoose.InferSchemaType<typeof settingsSchema>;
export type PresaleCallSlotDocument = mongoose.InferSchemaType<typeof callSlotSchema>;
export type PresaleCallRequestDocument = mongoose.InferSchemaType<typeof callRequestSchema>;

export const PresaleApplication = (mongoose.models.PresaleFoundersApplication as mongoose.Model<PresaleApplicationDocument>) || mongoose.model<PresaleApplicationDocument>("PresaleFoundersApplication", applicationSchema);
export const PresaleSettings = (mongoose.models.PresaleFoundersSettings as mongoose.Model<PresaleSettingsDocument>) || mongoose.model<PresaleSettingsDocument>("PresaleFoundersSettings", settingsSchema);
export const PresaleCallSlot = (mongoose.models.PresaleFoundersCallSlot as mongoose.Model<PresaleCallSlotDocument>) || mongoose.model<PresaleCallSlotDocument>("PresaleFoundersCallSlot", callSlotSchema);
export const PresaleCallRequest = (mongoose.models.PresaleFoundersCallRequest as mongoose.Model<PresaleCallRequestDocument>) || mongoose.model<PresaleCallRequestDocument>("PresaleFoundersCallRequest", callRequestSchema);
