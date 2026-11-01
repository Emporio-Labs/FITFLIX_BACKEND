import mongoose from "mongoose";

async function main() {
	const mongoUrl = process.env.MONGODB_URL;
	if (!mongoUrl) {
		console.error("No MONGODB_URL found");
		process.exit(1);
	}
	await mongoose.connect(mongoUrl);
	const Event = mongoose.model(
		"FitflixEvent",
		new mongoose.Schema({}, { strict: false }),
		"fitflixevents",
	);

	const res = await Event.updateOne(
		{ slug: "commune-part-2-sainikpuri" },
		{
			$set: {
				"collaborators.0.logoUrl": "/events/chapter-5-logo.jpg",
				"collaborators.0.name": "Chapter 5 Speciality Coffee",
				"collaborators.0.role": "Co-Host & Roastery Partner",
			},
		},
	);
	console.log("Updated commune-part-2-sainikpuri:", res);

	const check = await Event.findOne({ slug: "commune-part-2-sainikpuri" }).lean();
	console.log("Verified:", JSON.stringify((check as any)?.collaborators, null, 2));

	await mongoose.disconnect();
}

main().catch(console.error);
