import type mongoose from "mongoose";

export const applyIdTransform = (schema: mongoose.Schema) => {
	schema.set("toJSON", {
		virtuals: true,
		transform: (_doc, ret: Record<string, unknown>) => {
			delete ret._id;
			delete ret.__v;
			return ret;
		},
	});
};
