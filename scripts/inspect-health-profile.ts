import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import HealthMarkers from "../src/models/HealthMarkers";
import HealthGoals from "../src/models/HealthGoals";
import ConsentForm from "../src/models/ConsentForm";
import MedicalReport from "../src/models/MedicalReport";
import ExpertAppointment from "../src/models/ExpertAppointment";
import { HpodReport } from "../src/models/Hpodreport.model";
import NutritionProfile from "../src/models/nutrition-profile.model";
import connectDB from "../src/utils/db";

// Load environment variables
config();

// Helper to inspect nested objects and print key types + values recursively
function inspectObject(obj: any, indent = 0) {
	const spaces = " ".repeat(indent);
	if (obj === null) {
		console.log(`${spaces}\x1b[31m(Null)\x1b[0m: null`);
		return;
	}
	if (obj === undefined) {
		console.log(`${spaces}\x1b[31m(Undefined)\x1b[0m: undefined`);
		return;
	}

	// Handle ObjectId
	if (
		obj instanceof mongoose.Types.ObjectId ||
		(obj && obj.constructor?.name === "ObjectId") ||
		(obj && obj._bsontype === "ObjectID")
	) {
		console.log(`${spaces}\x1b[35m(ObjectId)\x1b[0m: "${obj.toString()}"`);
		return;
	}

	// Handle Date
	if (obj instanceof Date) {
		console.log(`${spaces}\x1b[36m(Date)\x1b[0m: ${obj.toISOString()}`);
		return;
	}

	// Handle Array
	if (Array.isArray(obj)) {
		if (obj.length === 0) {
			console.log(`${spaces}\x1b[33m(Array)\x1b[0m: []`);
		} else {
			const itemType = typeof obj[0];
			const isObj = itemType === "object" && obj[0] !== null;
			const constructorName = isObj ? (obj[0].constructor?.name || "Object") : itemType;
			console.log(`${spaces}\x1b[33m(Array of ${constructorName})\x1b[0m [size: ${obj.length}]:`);

			// Check if elements are primitive
			const allPrimitives = obj.every(
				(x) =>
					x === null ||
					x === undefined ||
					typeof x !== "object" ||
					x instanceof Date ||
					x instanceof mongoose.Types.ObjectId
			);

			if (allPrimitives) {
				for (let i = 0; i < obj.length; i++) {
					const val = obj[i];
					const displayVal =
						val instanceof Date
							? val.toISOString()
							: val instanceof mongoose.Types.ObjectId
							? `ObjectId("${val.toString()}")`
							: JSON.stringify(val);
					console.log(`${spaces}  - [${i}] ${displayVal}`);
				}
			} else {
				for (let i = 0; i < obj.length; i++) {
					console.log(`${spaces}  - [Index ${i}]:`);
					inspectObject(obj[i], indent + 4);
				}
			}
		}
		return;
	}

	// Handle Nested Object
	if (typeof obj === "object") {
		// Convert Mongoose Document to POJO if needed
		if (typeof obj.toObject === "function") {
			obj = obj.toObject();
		}

		const keys = Object.keys(obj);
		if (keys.length === 0) {
			console.log(`${spaces}\x1b[32m(Object)\x1b[0m: {}`);
			return;
		}

		// Sort keys to maintain clean layout
		keys.sort();

		for (const key of keys) {
			const val = obj[key];
			
			// Redact passwords or secrets to keep console safe
			if (key === "passwordHash") {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m \x1b[90m(String - Select:False)\x1b[0m: [Redacted Hash]`);
				continue;
			}

			if (val === null) {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m: \x1b[31m(Null)\x1b[0m null`);
			} else if (val === undefined) {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m: \x1b[31m(Undefined)\x1b[0m undefined`);
			} else if (
				val instanceof mongoose.Types.ObjectId ||
				(val && val.constructor?.name === "ObjectId") ||
				(val && val._bsontype === "ObjectID")
			) {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m: \x1b[35m(ObjectId)\x1b[0m "${val.toString()}"`);
			} else if (val instanceof Date) {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m: \x1b[36m(Date)\x1b[0m ${val.toISOString()}`);
			} else if (Array.isArray(val)) {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m:`);
				inspectObject(val, indent + 2);
			} else if (typeof val === "object") {
				console.log(`${spaces}• \x1b[32m${key}\x1b[0m: \x1b[90m(Object)\x1b[0m`);
				inspectObject(val, indent + 2);
			} else {
				console.log(
					`${spaces}• \x1b[32m${key}\x1b[0m \x1b[90m(${typeof val})\x1b[0m: ${JSON.stringify(val)}`
				);
			}
		}
		return;
	}

	// Primitives (shouldn't fall here directly unless root)
	console.log(`${spaces}\x1b[37m(${typeof obj})\x1b[0m: ${JSON.stringify(obj)}`);
}

// Check for dynamic fields related to injuries or conditions in an object
function scanForDynamicKeywords(obj: any, parentKey = ""): { key: string; val: any }[] {
	const matches: { key: string; val: any }[] = [];
	if (!obj || typeof obj !== "object") return matches;
	
	const keys = Object.keys(obj);
	for (const key of keys) {
		const val = obj[key];
		const fullKey = parentKey ? `${parentKey}.${key}` : key;
		if (key.toLowerCase().includes("injur")) {
			matches.push({ key: fullKey, val });
		} else if (typeof val === "object" && val !== null && !(val instanceof Date) && !(val instanceof mongoose.Types.ObjectId)) {
			matches.push(...scanForDynamicKeywords(val, fullKey));
		}
	}
	return matches;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		console.log("\x1b[31mError: Missing input parameter.\x1b[0m");
		console.log("Usage: bun run scripts/inspect-health-profile.ts <username_or_user_id>");
		console.log("Usage: bun run scripts/inspect-health-profile.ts --list   (To list users)");
		process.exit(1);
	}

	const input = args[0].trim();
	console.log(`\n\x1b[34m[INFO]\x1b[0m Connecting to MongoDB...`);
	try {
		await connectDB();
	} catch (error) {
		console.error("\x1b[31m[ERROR] Failed to connect to MongoDB:\x1b[0m", error);
		process.exit(1);
	}

	if (input === "--list" || input === "list") {
		console.log(`\x1b[34m[INFO]\x1b[0m Listing first 20 users in database...`);
		try {
			const users = await User.find({}).limit(20).select("_id username email phone").lean();
			if (users.length === 0) {
				console.log("\x1b[33mNo users found in database.\x1b[0m");
			} else {
				console.log(`\n\x1b[1m\x1b[32mFound ${users.length} users:\x1b[0m`);
				console.log("--------------------------------------------------------------------------------");
				for (const u of users) {
					console.log(`• \x1b[36mUsername:\x1b[0m ${u.username.padEnd(25)} \x1b[33mID:\x1b[0m ${u._id.toString().padEnd(25)} \x1b[90mEmail:\x1b[0m ${u.email || "N/A"}`);
				}
				console.log("--------------------------------------------------------------------------------");
			}
		} catch (err) {
			console.error("\x1b[31mFailed to list users:\x1b[0m", err);
		} finally {
			await mongoose.disconnect();
			console.log(`\x1b[34m[INFO]\x1b[0m Disconnected from MongoDB.`);
			process.exit(0);
		}
	}

	console.log(`\x1b[34m[INFO]\x1b[0m Searching for user matching input: "${input}"`);

	// Try querying by ID first if it looks like an ObjectId, otherwise query by username or email
	const isObjectId = mongoose.Types.ObjectId.isValid(input);
	let user = null;

	try {
		if (isObjectId) {
			user = await User.findById(input).lean();
		} else {
			// Find case-sensitive username or fallback to case-insensitive match
			user = await User.findOne({ username: input }).lean();
			if (!user) {
				user = await User.findOne({ username: { $regex: new RegExp(`^${input}$`, "i") } }).lean();
			}
			if (!user) {
				user = await User.findOne({ email: input }).lean();
			}
		}

		if (!user) {
			console.log(`\x1b[31m[ERROR] User not found matching input "${input}".\x1b[0m`);
			console.log(`\n\x1b[34m[TIP]\x1b[0m Run \x1b[33mbun run scripts/inspect-health-profile.ts --list\x1b[0m to see available users.`);
			await mongoose.disconnect();
			process.exit(1);
		}

		const userId = user._id;
		console.log(`\x1b[32m[SUCCESS] Found user: ${user.username} (ID: ${userId.toString()})\x1b[0m`);

		// Fetch all related health profile documents
		const [
			healthMarkers,
			healthGoals,
			consentForm,
			medicalReports,
			hpodReports,
			expertAppointments,
			nutritionProfile,
		] = await Promise.all([
			HealthMarkers.findOne({ userId }).lean(),
			HealthGoals.findOne({ userId }).lean(),
			ConsentForm.findOne({ userId }).lean(),
			MedicalReport.find({ userId }).lean(),
			HpodReport.find({ userId }).lean(),
			ExpertAppointment.find({ userId }).lean(),
			NutritionProfile.findOne({ userId }).lean(),
		]);

		console.log(`\n\x1b[35m================================================================================\x1b[0m`);
		console.log(`\x1b[1m\x1b[37m                     FITFLIX HEALTH PROFILE SCHEMA INSPECTION                   \x1b[0m`);
		console.log(`\x1b[35m================================================================================\x1b[0m`);
		console.log(`\x1b[33mUser ID:\x1b[0m      ${userId.toString()}`);
		console.log(`\x1b[33mUsername:\x1b[0m     ${user.username}`);
		console.log(`\x1b[33mEmail:\x1b[0m        ${user.email || "N/A"}`);
		console.log(`\x1b[33mPhone:\x1b[0m        ${user.phone}`);
		console.log(`\x1b[35m--------------------------------------------------------------------------------\x1b[0m`);

		// CATEGORY 1: HEALTH GOALS
		if (healthGoals || (user.healthGoals && user.healthGoals.length > 0)) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Health Goals]\x1b[0m`);
			if (user.healthGoals && user.healthGoals.length > 0) {
				console.log(`  \x1b[90m(from User collection)\x1b[0m`);
				console.log(`  • healthGoals \x1b[90m(Array of string)\x1b[0m: ${JSON.stringify(user.healthGoals)}`);
			}
			if (healthGoals) {
				console.log(`  \x1b[90m(from healthgoals collection)\x1b[0m`);
				inspectObject(healthGoals, 2);
			}
		}

		// CATEGORY 2: HEALTH MARKERS
		if (healthMarkers) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Health Markers]\x1b[0m \x1b[90m(from healthmarkers collection)\x1b[0m`);
			inspectObject(healthMarkers, 2);
		}

		// CATEGORY 3: MEDICAL CONDITIONS
		const diseaseHistory = healthMarkers?.diseaseHistory;
		const medicalConditions = nutritionProfile?.medicalConditions;
		if (
			(diseaseHistory && diseaseHistory.length > 0) ||
			(medicalConditions && medicalConditions.length > 0)
		) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Medical Conditions]\x1b[0m`);
			if (diseaseHistory && diseaseHistory.length > 0) {
				console.log(`  • diseaseHistory \x1b[90m(from healthmarkers)\x1b[0m: ${JSON.stringify(diseaseHistory)}`);
			}
			if (medicalConditions && medicalConditions.length > 0) {
				console.log(`  • medicalConditions \x1b[90m(from nutritionprofiles)\x1b[0m: ${JSON.stringify(medicalConditions)}`);
			}
		}

		// CATEGORY 4: ALLERGIES
		const markerAllergies = healthMarkers?.allergies;
		const nutritionAllergies = nutritionProfile?.allergies;
		if (
			(markerAllergies && markerAllergies.length > 0) ||
			(nutritionAllergies && nutritionAllergies.length > 0)
		) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Allergies]\x1b[0m`);
			if (markerAllergies && markerAllergies.length > 0) {
				console.log(`  • allergies \x1b[90m(from healthmarkers)\x1b[0m: ${JSON.stringify(markerAllergies)}`);
			}
			if (nutritionAllergies && nutritionAllergies.length > 0) {
				console.log(`  • allergies \x1b[90m(from nutritionprofiles)\x1b[0m: ${JSON.stringify(nutritionAllergies)}`);
			}
		}

		// CATEGORY 5: INJURIES (Scan all retrieved objects dynamically for keys resembling "injury")
		const injuryMatches: { source: string; key: string; val: any }[] = [];
		const collectionsToScan = [
			{ name: "User", doc: user },
			{ name: "HealthMarkers", doc: healthMarkers },
			{ name: "HealthGoals", doc: healthGoals },
			{ name: "NutritionProfile", doc: nutritionProfile },
		];
		for (const item of collectionsToScan) {
			if (item.doc) {
				const matches = scanForDynamicKeywords(item.doc);
				for (const m of matches) {
					injuryMatches.push({ source: item.name, key: m.key, val: m.val });
				}
			}
		}

		if (injuryMatches.length > 0) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Injuries]\x1b[0m \x1b[90m(Discovered dynamically)\x1b[0m`);
			for (const match of injuryMatches) {
				console.log(`  • [${match.source}] ${match.key}: ${JSON.stringify(match.val)}`);
			}
		}

		// CATEGORY 6: FITNESS LEVEL
		const workoutExp = healthGoals?.workoutExperience;
		if (workoutExp) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Fitness Level]\x1b[0m`);
			console.log(`  • workoutExperience \x1b[90m(from healthgoals)\x1b[0m: "${workoutExp}"`);
		}

		// CATEGORY 7: DNA ANALYSIS (Medical reports of type DNA)
		const dnaReports = medicalReports.filter((r) => r.reportType?.toUpperCase() === "DNA");
		if (dnaReports.length > 0) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: DNA Analysis Reports]\x1b[0m \x1b[90m(from medicalreports)\x1b[0m`);
			for (let i = 0; i < dnaReports.length; i++) {
				console.log(`  Report [${i + 1}]:`);
				inspectObject(dnaReports[i], 4);
			}
		}

		// CATEGORY 8: UPLOADED REPORTS (Other medical reports & HPOD reports)
		const nonDnaReports = medicalReports.filter((r) => r.reportType?.toUpperCase() !== "DNA");
		if (nonDnaReports.length > 0 || hpodReports.length > 0) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Uploaded Reports]\x1b[0m`);
			if (nonDnaReports.length > 0) {
				console.log(`  \x1b[90m(Medical Reports from medicalreports collection)\x1b[0m`);
				for (let i = 0; i < nonDnaReports.length; i++) {
					console.log(`  - Medical Report [${i + 1}]:`);
					inspectObject(nonDnaReports[i], 4);
				}
			}
			if (hpodReports.length > 0) {
				console.log(`  \x1b[90m(Gmail Ingested HPOD Reports from hpod_reports collection)\x1b[0m`);
				for (let i = 0; i < hpodReports.length; i++) {
					console.log(`  - HPOD Report [${i + 1}]:`);
					inspectObject(hpodReports[i], 4);
				}
			}
		}

		// CATEGORY 9: EXPERT RECOMMENDATIONS (Nutrition profiles, macro/calorie targets, expert appointments)
		if (nutritionProfile || expertAppointments.length > 0) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Expert Recommendations]\x1b[0m`);
			if (nutritionProfile) {
				console.log(`  \x1b[90m(Dietary recommendations from nutritionprofiles collection)\x1b[0m`);
				inspectObject(nutritionProfile, 2);
			}
			if (expertAppointments.length > 0) {
				console.log(`  \x1b[90m(Appointments from expertappointments collection)\x1b[0m`);
				for (let i = 0; i < expertAppointments.length; i++) {
					console.log(`  - Appointment [${i + 1}]:`);
					inspectObject(expertAppointments[i], 4);
				}
			}
		}

		// CATEGORY 10: CONSENT FORMS
		if (consentForm) {
			console.log(`\n\x1b[1m\x1b[36m[CATEGORY: Consent Forms]\x1b[0m \x1b[90m(from consentforms collection)\x1b[0m`);
			inspectObject(consentForm, 2);
		}

		console.log(`\n\x1b[35m================================================================================\x1b[0m`);
		console.log(`\x1b[32m[SUCCESS] Finished auditing health profile. No database writes performed.\x1b[0m`);
		console.log(`\x1b[35m================================================================================\x1b[0m`);

	} catch (error) {
		console.error("\x1b[31m[ERROR] Schema inspection execution failed:\x1b[0m", error);
	} finally {
		await mongoose.disconnect();
		console.log(`\x1b[34m[INFO]\x1b[0m Disconnected from MongoDB.`);
	}
}

main();
