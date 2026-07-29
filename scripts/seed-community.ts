import { config } from "dotenv";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import { CommunityRole, PostStatus } from "../src/models/Enums";
import Post from "../src/models/Post";
import PostMedia from "../src/models/PostMedia";
import Trainer from "../src/models/Trainer";
import connectDB from "../src/utils/db";

config();
const hasFlag = (f: string) => process.argv.slice(2).includes(f);

/**
 * Realistic launch content so the feed isn't empty on first open. Every seeded
 * post carries `isSeed: true` so it can be listed and removed before production
 * (`bun run seed:community --reset`). No PostVersion rows are written for seeds
 * (which keeps the append-only history clean and the seed removable).
 */
interface Seed {
	body: string;
	visibility: "public" | "members_only";
	official?: boolean;
}

const SEEDS: Seed[] = [
	// ── Gym announcements (official) ──
	{ body: "Welcome to the Fitflix community! Share your wins, ask questions, and train together. 🏋️", visibility: "public", official: true },
	{ body: "New Olympic platforms and a dedicated mobility zone are now open on the ground floor.", visibility: "public", official: true },
	{ body: "Holiday hours: we're open 6am–2pm on public holidays. Plan your sessions accordingly.", visibility: "public", official: true },
	{ body: "Members-only: early access to our new recovery suite (sauna + cold plunge) opens next week.", visibility: "members_only", official: true },

	// ── Workout plans (trainer) ──
	{ body: "Beginner full-body 3x/week: Squat, Bench, Row, Overhead Press, Deadlift. 3 sets of 5, add 2.5kg when all reps are clean.", visibility: "public" },
	{ body: "Push/Pull/Legs for intermediates — the exact split I run my clients through. Members: full PDF in your plans tab.", visibility: "members_only" },
	{ body: "Short on time? A 20-minute EMOM: 5 kettlebell swings, 10 push-ups, 15 air squats. Every minute on the minute.", visibility: "public" },
	{ body: "Deload week matters. Every 4–6 weeks, drop volume by 40%. You grow when you recover, not when you grind.", visibility: "public" },
	{ body: "Members: my 12-week hypertrophy block with weekly progressions and swap options for every lift.", visibility: "members_only" },
	{ body: "Two hard leg days a week beats five half-hearted ones. Intensity over frequency for most people.", visibility: "public" },

	// ── Nutrition tips (trainer) ──
	{ body: "Protein target: ~1.6–2.2g per kg of bodyweight. Spread it across 3–4 meals for best results.", visibility: "public" },
	{ body: "Hydrate before you're thirsty. Aim for pale-yellow urine — a simple, honest gauge all day.", visibility: "public" },
	{ body: "Members-only macro guide: how to set calories for a lean bulk without the winter fluff.", visibility: "members_only" },
	{ body: "Pre-workout: a banana + coffee 30 minutes out is enough for most sessions. Keep it simple.", visibility: "public" },
	{ body: "Fibre is the forgotten macro. 25–35g a day keeps digestion and appetite in check.", visibility: "public" },
	{ body: "Members: my grocery list + 6 high-protein meals under 20 minutes each.", visibility: "members_only" },

	// ── Form guidance (trainer) ──
	{ body: "Squat cue of the week: 'spread the floor' with your feet. Instantly stabilises the knees.", visibility: "public" },
	{ body: "Deadlift: the bar should graze your shins. If it drifts forward, your hips are rising too early.", visibility: "public" },
	{ body: "Overhead press: squeeze your glutes and brace. A soft midsection leaks power and hurts the lower back.", visibility: "public" },
	{ body: "Members: slow-motion form breakdowns for the big 4 lifts, filmed from three angles.", visibility: "members_only" },
	{ body: "Rows: lead with the elbows, not the hands. Think 'put your elbow in your back pocket.'", visibility: "public" },
	{ body: "Bench press: tuck the elbows ~45°. Flaring them to 90° is the fastest route to shoulder pain.", visibility: "public" },

	// ── Community / motivation ──
	{ body: "Consistency beats intensity. Three good weeks in a row will outperform one perfect day.", visibility: "public" },
	{ body: "Rest days are training days. Sleep and protein today — your next session depends on it.", visibility: "public" },
	{ body: "Post your PRs below — let's celebrate every plate added and every rep earned this month. 💪", visibility: "public" },
];

function toTestDbUrl(url: string): string {
	const [b, q] = url.split("?");
	const i = (b ?? url).indexOf("://");
	const a = (b ?? url).slice(i + 3);
	const s = a.indexOf("/");
	const host = s === -1 ? a : a.slice(0, s);
	const db = s === -1 ? "fitflix" : a.slice(s + 1);
	const out = `${(b ?? url).slice(0, i + 3)}${host}/${db}_community_test`;
	return q ? `${out}?${q}` : out;
}

async function main(): Promise<void> {
	const reset = hasFlag("--reset");
	try {
		if (hasFlag("--test")) {
			const raw = process.env.MONGODB_URL;
			if (!raw) throw new Error("MONGODB_URL not configured");
			await mongoose.connect(toTestDbUrl(raw));
		} else {
			await connectDB();
		}

		if (reset) {
			const seedPosts = await Post.find({ isSeed: true })
				.select("_id")
				.lean<{ _id: mongoose.Types.ObjectId }[]>();
			const ids = seedPosts.map((p) => p._id);
			await PostMedia.deleteMany({ postId: { $in: ids } });
			await Post.deleteMany({ isSeed: true });
			console.log(`Removed ${ids.length} seed posts.`);
			await mongoose.disconnect();
			process.exit(0);
		}

		const existing = await Post.countDocuments({ isSeed: true });
		if (existing > 0) {
			console.log(
				`${existing} seed posts already present — nothing to do. Use --reset to replace.`,
			);
			await mongoose.disconnect();
			process.exit(0);
		}

		// Seed authors: a "Fitflix Coaches" trainer and the gym admin account.
		const trainer =
			(await Trainer.findOne({ trainerName: "Fitflix Coaches" })) ??
			(await Trainer.create({
				trainerName: "Fitflix Coaches",
				email: "coaches@fitflix.seed",
				phone: "0000000000",
				passwordHash: "seed-no-login",
			}));
		const admin =
			(await Admin.findOne({})) ??
			(await Admin.create({
				adminName: "Fitflix",
				email: "gym@fitflix.seed",
				phone: "0000000000",
				passwordHash: "seed-no-login",
			}));

		// Spread createdAt so the feed reads naturally (newest first).
		const now = Date.now();
		const docs = SEEDS.map((s, i) => ({
			authorId: s.official ? admin._id : trainer._id,
			authorRole: s.official ? CommunityRole.Admin : CommunityRole.Trainer,
			content: s.body,
			visibility: s.visibility,
			status: PostStatus.Published,
			isOfficial: Boolean(s.official),
			isSeed: true,
			createdAt: new Date(now - (SEEDS.length - i) * 3_600_000),
			updatedAt: new Date(now - (SEEDS.length - i) * 3_600_000),
		}));
		await Post.insertMany(docs);

		console.log(
			`Seeded ${docs.length} community posts (isSeed:true). ` +
				`${SEEDS.filter((s) => s.visibility === "members_only").length} members_only, ` +
				`${SEEDS.filter((s) => s.official).length} official.`,
		);
		console.log(
			"NOTE: text-only seeds for reliability. To seed with images, upload via " +
				"POST /community/media/images and attach on create (needs S3).",
		);
	} catch (error) {
		console.error("Seeding failed:", error);
		await mongoose.disconnect();
		process.exit(1);
	}

	await mongoose.disconnect();
	process.exit(0);
}

main();
