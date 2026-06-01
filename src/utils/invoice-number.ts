import Counter from "../models/Counter";

export const generateInvoiceNumber = async (): Promise<string> => {
	const year = new Date().getFullYear();
	const counterId = `invoice_${year}`;

	const counter = await Counter.findOneAndUpdate(
		{ _id: counterId },
		{ $inc: { seq: 1 } },
		{ upsert: true, returnDocument: "after" },
	);

	if (!counter) {
		throw new Error("Failed to generate invoice number");
	}

	const seq = String(counter.seq).padStart(4, "0");
	return `FX-${year}-${seq}`;
};
