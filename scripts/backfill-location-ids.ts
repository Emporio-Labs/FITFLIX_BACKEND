import { config } from "dotenv";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import BcaMetric from "../src/models/BcaMetric";
import Booking from "../src/models/Bookings";
import Class from "../src/models/Class";
import ExpertAppointment from "../src/models/ExpertAppointment";
import ExpertSchedule from "../src/models/ExpertSchedule";
import Invoice from "../src/models/Invoice";
import Lead from "../src/models/Lead";
import Location from "../src/models/Location";
import Membership from "../src/models/Membership";
import MembershipPlan from "../src/models/MembershipPlan";
import NutritionistBooking from "../src/models/NutritionistBooking";
import Schedule from "../src/models/Schedule";
import ScheduledSession from "../src/models/ScheduledSession";
import Service from "../src/models/Service";
import Slot from "../src/models/Slots";
import Therapy from "../src/models/Therapy";
import Trainer from "../src/models/Trainer";
import TrainerChangeRequest from "../src/models/TrainerChangeRequest";
import User from "../src/models/User";
import WorkoutPlanAssignment from "../src/models/WorkoutPlanAssignment";
import NutritionTemplate from "../src/models/nutrition-template.model";
import connectDB from "../src/utils/db";
import { resolveLocationId } from "../src/utils/location.resolver";

config();

/**
 * One-shot backfill: stamp `locationId` onto every branch-scoped document
 * that predates the schema change. Idempotent — a doc that already has a
 * value is skipped, so a repeat run is safe. Parents run before children so
 * inheritance produces the same answer the write path would.
 *
 * A doc that cannot be resolved stays `null` (a valid company-wide value)
 * and is reported at the end. The script never fails on unresolved rows.
 */

type ObjectId = mongoose.Types.ObjectId;
type Counters = {
	scanned: number;
	fromParent: number;
	fromUser: number;
	defaulted: number;
	skipped: number;
	unresolved: number;
};

const emptyCounters = (): Counters => ({
	scanned: 0,
	fromParent: 0,
	fromUser: 0,
	defaulted: 0,
	skipped: 0,
	unresolved: 0,
});

const hasFlag = (flag: string): boolean =>
	process.argv.slice(2).includes(flag);

const argValue = (flag: string): string | null => {
	const args = process.argv.slice(2);
	const index = args.indexOf(flag);
	if (index >= 0 && index + 1 < args.length) {
		const value = args[index + 1];
		return value && !value.startsWith("--") ? value : null;
	}
	return null;
};

const printUsage = () => {
	console.log(
		"Usage: bun run scripts/backfill-location-ids.ts [--dry-run] [--location <code>] [--verify]",
	);
	console.log(
		"  --dry-run          Report the counts without writing anything",
	);
	console.log(
		"  --location <code>  Default branch for docs with no parent link",
	);
	console.log(
		"  --verify           Count docs still missing a branch and exit non-zero if any",
	);
};

/**
 * FX-01.1 verifier. An operator (not the developer) runs this to prove that
 * every branch-scoped record actually carries a branch. Prints one line per
 * collection with the count of unstamped documents, and exits non-zero when
 * any total is non-empty for a collection whose records are supposed to carry
 * a hard branch.
 *
 * Catalog collections (`services`, `therapies`, plans, templates) are
 * deliberately allowed to hold `locationId: null` — that value means
 * "available at every branch" — so they are reported but do not fail the
 * check.
 */
const runVerifier = async (): Promise<void> => {
	type Target = {
		label: string;
		model: mongoose.Model<any>;
		catalog?: boolean;
	};

	// Kept in one place so a future record type is one line to add.
	const [
		{ default: Admin },
		{ default: BcaMetric },
		{ default: Booking },
		{ default: Class },
		{ default: CreditTransaction },
		{ default: ExpertAppointment },
		{ default: ExpertSchedule },
		{ default: Invoice },
		{ default: Lead },
		{ default: Membership },
		{ default: MembershipPlan },
		{ default: NutritionistBooking },
		{ default: NutritionTemplate },
		{ default: Schedule },
		{ default: ScheduledSession },
		{ default: Service },
		{ default: Slot },
		{ default: Therapy },
		{ default: Trainer },
		{ default: TrainerChangeRequest },
		{ default: User },
		{ default: WorkoutPlanAssignment },
	] = await Promise.all([
		import("../src/models/Admin"),
		import("../src/models/BcaMetric"),
		import("../src/models/Bookings"),
		import("../src/models/Class"),
		import("../src/models/CreditTransaction"),
		import("../src/models/ExpertAppointment"),
		import("../src/models/ExpertSchedule"),
		import("../src/models/Invoice"),
		import("../src/models/Lead"),
		import("../src/models/Membership"),
		import("../src/models/MembershipPlan"),
		import("../src/models/NutritionistBooking"),
		import("../src/models/nutrition-template.model"),
		import("../src/models/Schedule"),
		import("../src/models/ScheduledSession"),
		import("../src/models/Service"),
		import("../src/models/Slots"),
		import("../src/models/Therapy"),
		import("../src/models/Trainer"),
		import("../src/models/TrainerChangeRequest"),
		import("../src/models/User"),
		import("../src/models/WorkoutPlanAssignment"),
	]);

	// Records that MUST carry a branch — a null is a failure.
	const strict: Target[] = [
		{ label: "Trainer", model: Trainer },
		{ label: "Class", model: Class },
		{ label: "Slot", model: Slot },
		{ label: "Booking", model: Booking },
		{ label: "ScheduledSession", model: ScheduledSession },
		{ label: "Membership", model: Membership },
		{ label: "Invoice", model: Invoice },
		{ label: "CreditTransaction", model: CreditTransaction },
		{ label: "Lead", model: Lead },
		{ label: "ExpertAppointment", model: ExpertAppointment },
		{ label: "NutritionistBooking", model: NutritionistBooking },
		{ label: "TrainerChangeRequest", model: TrainerChangeRequest },
		{ label: "WorkoutPlanAssignment", model: WorkoutPlanAssignment },
		{ label: "BcaMetric", model: BcaMetric },
		{ label: "ExpertSchedule", model: ExpertSchedule },
		{ label: "Schedule", model: Schedule },
	];

	// Records whose null branch is legal (company-wide catalog).
	const catalog: Target[] = [
		{ label: "Service", model: Service, catalog: true },
		{ label: "Therapy", model: Therapy, catalog: true },
		{ label: "MembershipPlan", model: MembershipPlan, catalog: true },
		{ label: "NutritionTemplate", model: NutritionTemplate, catalog: true },
	];

	console.log("Verifier — records missing a branch:");

	let strictFailures = 0;
	for (const { label, model } of strict) {
		const missing = await model.countDocuments({
			locationId: { $in: [null, undefined] },
		});
		if (missing > 0) {
			strictFailures += missing;
			console.log(`  [FAIL] ${label}: ${missing} document(s) without a branch`);
		} else {
			console.log(`  [OK]   ${label}: 0`);
		}
	}
	for (const { label, model } of catalog) {
		const missing = await model.countDocuments({
			locationId: { $in: [null, undefined] },
		});
		console.log(
			`  [info] ${label}: ${missing} document(s) with null branch (catalog — legal)`,
		);
	}

	// Members are the FX-01.3 half — homeLocationId, not locationId. The User
	// schema is strictly typed here so the raw literal is cast to keep TS
	// happy without loosening the model definition.
	const homelessMembers = await (
		User as mongoose.Model<any>
	).countDocuments({
		homeLocationId: { $in: [null, undefined] },
	});
	if (homelessMembers > 0) {
		strictFailures += homelessMembers;
		console.log(
			`  [FAIL] User (homeLocationId): ${homelessMembers} member(s) without a home branch`,
		);
	} else {
		console.log(`  [OK]   User (homeLocationId): 0`);
	}

	// Admin is not FX-01 scope — a company-wide admin has no branches by design.
	const globalAdmins = await Admin.countDocuments({ isGlobal: true });
	const scopedAdmins = await Admin.countDocuments({
		isGlobal: { $ne: true },
		locationIds: { $exists: true, $not: { $size: 0 } },
	});
	console.log(
		`  [info] Admin: ${globalAdmins} global, ${scopedAdmins} branch-scoped`,
	);

	if (strictFailures > 0) {
		console.error(
			`\nFAIL: ${strictFailures} document(s) across the strict collections have no branch. Run the backfill without --verify to stamp them.`,
		);
		process.exitCode = 1;
	} else {
		console.log("\nOK: every branch-scoped record has a branch.");
	}
};

const asObjectId = (value: unknown): ObjectId | null =>
	value instanceof mongoose.Types.ObjectId
		? value
		: typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
			? new mongoose.Types.ObjectId(value)
			: null;

/**
 * Stream a collection and flush bulk writes in batches. Loading everything
 * into memory (the pattern in migrate-credits.ts) is fine for a small ledger
 * but not for Bookings / ScheduledSession / Invoice, which can be large.
 */
async function bulkBackfill(
	model: mongoose.Model<any>,
	label: string,
	resolveOne: (doc: any) => Promise<{
		locationId: ObjectId | null;
		source: "parent" | "user" | "default";
	} | null>,
	dryRun: boolean,
): Promise<Counters> {
	const counters = emptyCounters();
	const cursor = model
		.find({ locationId: { $in: [null, undefined] } })
		.cursor();
	const ops: mongoose.AnyBulkWriteOperation<any>[] = [];

	const flush = async () => {
		if (ops.length === 0 || dryRun) {
			ops.length = 0;
			return;
		}
		await model.bulkWrite(ops, { ordered: false });
		ops.length = 0;
	};

	for await (const doc of cursor) {
		counters.scanned += 1;
		const resolved = await resolveOne(doc);
		if (!resolved) {
			counters.unresolved += 1;
			continue;
		}
		if (resolved.source === "parent") counters.fromParent += 1;
		if (resolved.source === "user") counters.fromUser += 1;
		if (resolved.source === "default") counters.defaulted += 1;
		if (!resolved.locationId) {
			// null is a valid company-wide value — not written, but not an error.
			counters.skipped += 1;
			continue;
		}
		ops.push({
			updateOne: {
				filter: { _id: doc._id },
				update: { $set: { locationId: resolved.locationId } },
			},
		});
		if (ops.length >= 1000) {
			await flush();
		}
	}

	await flush();

	console.log(
		`  ${label}: scanned=${counters.scanned} fromParent=${counters.fromParent} fromUser=${counters.fromUser} defaulted=${counters.defaulted} unresolved=${counters.unresolved}`,
	);
	return counters;
}

async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");
	const verifyOnly = hasFlag("--verify");
	const defaultCode = argValue("--location");

	try {
		await connectDB();

		if (verifyOnly) {
			await runVerifier();
			return;
		}

		// Resolve the default branch once. Explicit --location wins; otherwise
		// let the resolver pick the sole active branch when there is one, and
		// stay null when there are multiple (docs are unresolved rather than
		// mis-attributed).
		let defaultLocation: ObjectId | null = null;
		if (defaultCode) {
			const loc = await Location.findOne({
				code: defaultCode.toLowerCase(),
			}).select("_id");
			if (!loc) {
				console.error(`Unknown branch code: ${defaultCode}`);
				process.exitCode = 1;
				return;
			}
			defaultLocation = loc._id;
		} else {
			try {
				defaultLocation = await resolveLocationId(null);
			} catch {
				defaultLocation = null;
			}
		}

		console.log(
			`Backfill starting. dryRun=${dryRun} defaultLocation=${
				defaultLocation ? defaultLocation.toString() : "<none>"
			}`,
		);

		// Cached member lookup — most collections keyed by userId hit the same
		// members many times over.
		const userCache = new Map<string, ObjectId | null>();
		const userHomeLocation = async (
			userId: unknown,
		): Promise<ObjectId | null> => {
			const id = asObjectId(userId);
			if (!id) return null;
			const key = id.toString();
			if (userCache.has(key)) return userCache.get(key) ?? null;
			const user = await User.findById(id).select("homeLocationId").lean();
			const raw = (user as { homeLocationId?: unknown } | null)?.homeLocationId;
			const value = asObjectId(raw);
			userCache.set(key, value);
			return value;
		};

		const finalize = (
			locationId: ObjectId | null,
			source: "parent" | "user" | "default",
		) =>
			locationId
				? { locationId, source }
				: defaultLocation
					? { locationId: defaultLocation, source: "default" as const }
					: null;

		// ── Admin ────────────────────────────────────────────────────────────
		// Pre-migration admins are marked global so they keep the access they
		// had before the enforcement layer landed.
		{
			const filter = { isGlobal: { $ne: true }, locationIds: { $size: 0 } };
			const count = await Admin.countDocuments(filter);
			if (!dryRun && count > 0) {
				await Admin.updateMany(filter, { $set: { isGlobal: true } });
			}
			console.log(`  Admin: promoted ${count} to isGlobal=true`);
		}

		// ── Catalog (no parent — a null locationId is the right answer) ─────
		for (const [model, label] of [
			[Service, "Service"],
			[Therapy, "Therapy"],
			[MembershipPlan, "MembershipPlan"],
			[NutritionTemplate, "NutritionTemplate"],
		] as const) {
			await bulkBackfill(
				model as mongoose.Model<any>,
				label,
				async () => ({ locationId: null, source: "default" }),
				dryRun,
			);
		}

		// ── ExpertSchedule: inherit from the underlying Trainer where possible.
		await bulkBackfill(
			ExpertSchedule as mongoose.Model<any>,
			"ExpertSchedule",
			async (doc) => {
				if (doc.expertModel === "Trainer") {
					const trainer = await Trainer.findById(doc.expertId).select(
						"locationId",
					);
					const raw = (trainer as { locationId?: unknown } | null)?.locationId;
					const id = asObjectId(raw);
					if (id) return { locationId: id, source: "parent" };
				}
				return finalize(null, "default");
			},
			dryRun,
		);

		// ── ScheduledSession: inherit from Class.
		await bulkBackfill(
			ScheduledSession as mongoose.Model<any>,
			"ScheduledSession",
			async (doc) => {
				const cls = await Class.findById(doc.classId).select("locationId");
				const raw = (cls as { locationId?: unknown } | null)?.locationId;
				const id = asObjectId(raw);
				if (id) return { locationId: id, source: "parent" };
				return finalize(null, "default");
			},
			dryRun,
		);

		// ── Bookings: slot → class → user home club.
		await bulkBackfill(
			Booking as mongoose.Model<any>,
			"Booking",
			async (doc) => {
				if (doc.slot) {
					const slot = await Slot.findById(doc.slot).select("locationId");
					const raw = (slot as { locationId?: unknown } | null)?.locationId;
					const id = asObjectId(raw);
					if (id) return { locationId: id, source: "parent" };
				}
				if (doc.classId) {
					const cls = await Class.findById(doc.classId).select("locationId");
					const raw = (cls as { locationId?: unknown } | null)?.locationId;
					const id = asObjectId(raw);
					if (id) return { locationId: id, source: "parent" };
				}
				const home = await userHomeLocation(doc.user);
				return finalize(home, home ? "user" : "default");
			},
			dryRun,
		);

		// ── ExpertAppointment / NutritionistBooking: slot → user home club.
		for (const [model, label] of [
			[ExpertAppointment, "ExpertAppointment"],
			[NutritionistBooking, "NutritionistBooking"],
		] as const) {
			await bulkBackfill(
				model as mongoose.Model<any>,
				label,
				async (doc) => {
					if (doc.slotId) {
						const slot = await Slot.findById(doc.slotId).select("locationId");
						const raw = (slot as { locationId?: unknown } | null)?.locationId;
						const id = asObjectId(raw);
						if (id) return { locationId: id, source: "parent" };
					}
					const home = await userHomeLocation(doc.userId);
					return finalize(home, home ? "user" : "default");
				},
				dryRun,
			);
		}

		// ── Invoice: latest membership → user home club.
		await bulkBackfill(
			Invoice as mongoose.Model<any>,
			"Invoice",
			async (doc) => {
				if (doc.userId) {
					const member = await Membership.findOne({ user: doc.userId })
						.select("locationId")
						.sort({ createdAt: -1 });
					const raw = (member as { locationId?: unknown } | null)?.locationId;
					const id = asObjectId(raw);
					if (id) return { locationId: id, source: "parent" };
					const home = await userHomeLocation(doc.userId);
					if (home) return { locationId: home, source: "user" };
				}
				return finalize(null, "default");
			},
			dryRun,
		);

		// ── Lead: unconverted leads have no parent; fall back to default.
		await bulkBackfill(
			Lead as mongoose.Model<any>,
			"Lead",
			async (doc) => {
				if (doc.convertedUser) {
					const home = await userHomeLocation(doc.convertedUser);
					if (home) return { locationId: home, source: "user" };
				}
				return finalize(null, "default");
			},
			dryRun,
		);

		// ── Schedule: only the user is known.
		await bulkBackfill(
			Schedule as mongoose.Model<any>,
			"Schedule",
			async (doc) => {
				const home = await userHomeLocation(doc.user);
				return finalize(home, home ? "user" : "default");
			},
			dryRun,
		);

		// ── TrainerChangeRequest: requested → current trainer.
		await bulkBackfill(
			TrainerChangeRequest as mongoose.Model<any>,
			"TrainerChangeRequest",
			async (doc) => {
				for (const key of ["requestedTrainerId", "currentTrainerId"] as const) {
					const id = doc[key];
					if (!id) continue;
					const trainer = await Trainer.findById(id).select("locationId");
					const raw = (trainer as { locationId?: unknown } | null)?.locationId;
					const objId = asObjectId(raw);
					if (objId) return { locationId: objId, source: "parent" };
				}
				return finalize(null, "default");
			},
			dryRun,
		);

		// ── WorkoutPlanAssignment: trainer when the assigner is one.
		await bulkBackfill(
			WorkoutPlanAssignment as mongoose.Model<any>,
			"WorkoutPlanAssignment",
			async (doc) => {
				if (doc.assignedByModel === "Trainer" && doc.assignedBy) {
					const trainer = await Trainer.findById(doc.assignedBy).select(
						"locationId",
					);
					const raw = (trainer as { locationId?: unknown } | null)?.locationId;
					const id = asObjectId(raw);
					if (id) return { locationId: id, source: "parent" };
				}
				const home = await userHomeLocation(doc.userId);
				return finalize(home, home ? "user" : "default");
			},
			dryRun,
		);

		// ── BcaMetric: the member's home club is the machine's branch.
		await bulkBackfill(
			BcaMetric as mongoose.Model<any>,
			"BcaMetric",
			async (doc) => {
				const home = await userHomeLocation(doc.userId);
				return finalize(home, home ? "user" : "default");
			},
			dryRun,
		);

		console.log(
			dryRun
				? "Dry run complete. No database changes were applied."
				: "Backfill complete.",
		);
	} catch (error) {
		console.error("Backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
