import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	seq: { type: Number, default: 0 },
});

type CounterDocument = mongoose.InferSchemaType<typeof counterSchema>;

export default (mongoose.models.Counter as mongoose.Model<CounterDocument>) ||
	mongoose.model<CounterDocument>("Counter", counterSchema);
