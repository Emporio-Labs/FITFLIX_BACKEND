import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

/**
 * Standard recognized fitness specialities mapping (canonical Title Case)
 */
const CANONICAL_SPECIALITY_MAP: Record<string, string> = {
	yoga: "Yoga",
	nutrition: "Nutrition",
	hit: "HIIT",
	hiit: "HIIT",
	cardio: "Cardio",
	strength: "Strength Training",
	"strength training": "Strength Training",
	hypertrophy: "Hypertrophy",
	mobility: "Mobility & Flexibility",
	"mobility & flexibility": "Mobility & Flexibility",
	conditioning: "Conditioning",
	"cardio conditioning": "Cardio Conditioning",
	calisthenics: "Calisthenics",
	bodybuilding: "Bodybuilding",
	"functional training": "Functional Training",
	powerlifting: "Powerlifting",
	"weight loss": "Weight Loss",
	rehabilitation: "Rehabilitation",
	crossfit: "CrossFit",
};

async function main() {
	const mongoUrl = process.env.MONGODB_URL;
	if (!mongoUrl) {
		console.error("MONGODB_URL is missing in environment");
		process.exit(1);
	}

	await mongoose.connect(mongoUrl);
	console.log("Connected to MongoDB");

	const trainersCol = mongoose.connection.collection("trainers");
	const trainers = await trainersCol.find({}).toArray();

	let updatedCount = 0;

	for (const trainer of trainers) {
		const rawSpecs: string[] = Array.isArray(trainer.specialities) ? trainer.specialities : [];
		if (rawSpecs.length === 0) continue;

		const cleanedSpecs: string[] = [];
		for (const raw of rawSpecs) {
			const trimmed = raw.trim();
			if (!trimmed) continue;
			const lower = trimmed.toLowerCase();

			if (CANONICAL_SPECIALITY_MAP[lower]) {
				const canon = CANONICAL_SPECIALITY_MAP[lower];
				if (!cleanedSpecs.includes(canon)) {
					cleanedSpecs.push(canon);
				}
			} else if (
				trimmed.length >= 3 &&
				!/^[0-9]+$/.test(trimmed) &&
				!["hh ss", "uuios", "saouh", "iis", "asd", "as", "dfad.a.d", "dadagaedr", "yupaos", "asdasf", "as edeq3e", "e334", "00"].includes(lower)
			) {
				// Keep custom speciality if it doesn't look like garbage test data
				const titleCased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
				if (!cleanedSpecs.includes(titleCased)) {
					cleanedSpecs.push(titleCased);
				}
			}
		}

		// Check if specialities changed
		const changed =
			rawSpecs.length !== cleanedSpecs.length ||
			rawSpecs.some((s, idx) => s !== cleanedSpecs[idx]);

		if (changed) {
			await trainersCol.updateOne(
				{ _id: trainer._id },
				{ $set: { specialities: cleanedSpecs } }
			);
			console.log(`Cleaned specialities for ${trainer.trainerName}: [${rawSpecs.join(", ")}] -> [${cleanedSpecs.join(", ")}]`);
			updatedCount++;
		}
	}

	console.log(`Specialities cleanup complete. Updated ${updatedCount} trainer records.`);
	await mongoose.disconnect();
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
