import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * A thin marketing layer over things that already exist.
 *
 * A promotion never owns content — it points at a class, a therapy, a
 * membership plan or an external URL. Booking, credits and cancellation stay
 * with the linked entity rather than growing a parallel stack here.
 *
 * `mode` is the promotion's own field rather than something inherited from the
 * link target: a `url` link has no target to inherit from, and a promo for a
 * hybrid class may still be pitched at a single audience. Null matches both,
 * mirroring how the app already adapts a hybrid class to "no preference".
 */

export const PROMOTION_LINK_TYPES = [
	"class",
	"therapy",
	"plan",
	"url",
] as const;

export const PROMOTION_MODES = ["online", "offline"] as const;

const linkSchema = new mongoose.Schema(
	{
		type: { type: String, enum: PROMOTION_LINK_TYPES, required: true },
		// Set for class | therapy | plan. The collection it points into varies
		// by type, so this stays a bare ObjectId rather than a typed ref.
		targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
		// Set for type: "url" only.
		url: { type: String, default: null, trim: true },
	},
	{ _id: false },
);

const promotionSchema = new mongoose.Schema(
	{
		// Null means company-wide. A branch's members see their own plus the
		// company-wide set; they never see another branch's offer.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
		title: { type: String, required: true, trim: true },
		imageUrl: { type: String, required: true, trim: true },
		subtext: { type: String, default: "", trim: true },
		tag: { type: String, default: "", trim: true },
		mode: { type: String, enum: [...PROMOTION_MODES, null], default: null },
		link: { type: linkSchema, required: true },
		activeFrom: { type: Date, required: true },
		// Required on purpose. A promo nobody remembers to switch off is the
		// failure mode this surface is most prone to.
		activeTo: { type: Date, required: true },
		// Higher wins. Ties break on the most recently started promotion.
		priority: { type: Number, default: 0 },
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

// Serves the member read path: live, in-window, ordered.
promotionSchema.index({ isActive: 1, activeFrom: 1, activeTo: 1, priority: -1 });
promotionSchema.index({ locationId: 1, isActive: 1 });

applyIdTransform(promotionSchema);

type PromotionDocument = mongoose.InferSchemaType<typeof promotionSchema>;

export default (mongoose.models.Promotion as mongoose.Model<PromotionDocument>) ||
	mongoose.model<PromotionDocument>("Promotion", promotionSchema);
