import type mongoose from "mongoose";

type Db = mongoose.mongo.Db;
type Document = mongoose.mongo.Document;
type BulkOp = mongoose.mongo.AnyBulkWriteOperation<Document>;

/**
 * FX-02: give records created before FX-01 their branch, by the same rules
 * FX-01 applies to new ones (utils/location-stamp.plugin.ts):
 *
 *   - a booking takes the branch of the slot / class it booked
 *   - a membership, invoice or credit entry takes the member's home branch
 *     (an invoice to a lead, the lead's branch)
 *   - everything else, and anything the rule can't resolve, the default
 *     branch — the one active branch
 *
 * Works on raw collections: no models, so no hooks, no auto-created
 * collections or indexes, and the dry run writes nothing at all.
 *
 * Kinds run in dependency order — members and classes/slots first, so the
 * bookings and money records that derive from them see their branch. Each
 * write is filtered on the field still being empty, so a re-run changes
 * nothing and a branch already set is never overwritten.
 *
 * With more than one active branch there is no default: records the rules
 * can't place are counted as unresolved and left alone.
 */

type Kind = {
	label: string;
	collection: string;
	field: string;
	filter?: Document;
	/** Aggregation stages that set `_derived` (may be null). */
	derive?: Document[];
};

const first = (path: string) => ({ $arrayElemAt: [path, 0] });

/** `$lookup` of one field on another collection by _id, into `as`. */
const lookupField = (
	from: string,
	localField: string,
	field: string,
	as: string,
): Document[] => [
	{
		$lookup: {
			from,
			localField,
			foreignField: "_id",
			as: `${as}__docs`,
			pipeline: [{ $project: { [field]: 1 } }],
		},
	},
	{ $set: { [as]: first(`$${as}__docs.${field}`) } },
];

const homeOf = (userField: string, as: string) =>
	lookupField("users", userField, "homeLocationId", as);

const coalesce = (...paths: string[]) =>
	paths.reduceRight<unknown>((acc, p) => ({ $ifNull: [p, acc] }), null);

export const BACKFILL_KINDS: Kind[] = [
	// ── No derivation: the default branch ────────────────────────────────
	{
		label: "member",
		collection: "users",
		field: "homeLocationId",
		// Staff stored as Users (experts) have no home branch by design.
		filter: { staffRole: null },
	},
	{ label: "class", collection: "classes", field: "locationId" },
	{
		label: "slot",
		collection: "slots",
		field: "locationId",
		// A daily slot's per-day copy follows its template.
		derive: [
			...lookupField("slots", "parentTemplate", "locationId", "_tpl"),
			{ $set: { _derived: "$_tpl" } },
		],
	},
	{ label: "trainer", collection: "trainers", field: "locationId" },
	{ label: "lead", collection: "leads", field: "locationId" },
	// ── Bookings: the branch of what was booked ──────────────────────────
	{
		label: "booking",
		collection: "unifiedbookings",
		field: "locationId",
		derive: [
			...lookupField("slots", "slotId", "locationId", "_slot"),
			...homeOf("userId", "_home"),
			{ $set: { _derived: coalesce("$_slot", "$_home") } },
		],
	},
	{
		label: "booking (legacy)",
		collection: "bookings",
		field: "locationId",
		derive: [
			...lookupField(
				"scheduledsessions",
				"sessionId",
				"classId",
				"_sessionClass",
			),
			{ $set: { _classKey: coalesce("$classId", "$_sessionClass") } },
			...lookupField("classes", "_classKey", "locationId", "_class"),
			...lookupField("slots", "slot", "locationId", "_slot"),
			...homeOf("user", "_home"),
			{ $set: { _derived: coalesce("$_class", "$_slot", "$_home") } },
		],
	},
	// ── Money: the member's home branch ──────────────────────────────────
	{
		label: "membership",
		collection: "memberships",
		field: "locationId",
		derive: [...homeOf("user", "_home"), { $set: { _derived: "$_home" } }],
	},
	{
		label: "credit entry",
		collection: "credittransactions",
		field: "locationId",
		derive: [...homeOf("user", "_home"), { $set: { _derived: "$_home" } }],
	},
	{
		label: "invoice",
		collection: "invoices",
		field: "locationId",
		derive: [
			...homeOf("userId", "_home"),
			...lookupField("leads", "leadId", "locationId", "_lead"),
			{ $set: { _derived: coalesce("$_home", "$_lead") } },
		],
	},
];

export type KindReport = {
	label: string;
	total: number;
	missing: number;
	/** Would get / got a branch from its own rule. */
	fromRule: number;
	/** Would get / got the default branch. */
	fromDefault: number;
	/** No rule and no default — left empty. */
	unresolved: number;
	/** Rows actually changed (0 in a dry run). */
	written: number;
};

export type BackfillReport = {
	defaultLocationId: string | null;
	activeLocations: number;
	kinds: KindReport[];
};

const BATCH = 500;

export async function backfillBranches(
	db: Db,
	options: { apply: boolean },
): Promise<BackfillReport> {
	const active = await db
		.collection("locations")
		.find({ isActive: { $ne: false } }, { projection: { _id: 1 } })
		.limit(2)
		.toArray();
	const defaultId = active.length === 1 ? (active[0]?._id ?? null) : null;

	const kinds: KindReport[] = [];
	for (const kind of BACKFILL_KINDS) {
		const col = db.collection(kind.collection);
		const empty = { ...kind.filter, [kind.field]: { $in: [null] } };
		const [total, missing] = await Promise.all([
			col.countDocuments(kind.filter ?? {}),
			col.countDocuments(empty),
		]);
		const report: KindReport = {
			label: kind.label,
			total,
			missing,
			fromRule: 0,
			fromDefault: 0,
			unresolved: 0,
			written: 0,
		};

		const cursor = col.aggregate([
			{ $match: empty },
			...(kind.derive ?? []),
			{ $project: { _id: 1, _derived: 1 } },
		]);

		let ops: BulkOp[] = [];
		const flush = async () => {
			if (options.apply && ops.length) {
				const res = await col.bulkWrite(ops, { ordered: false });
				report.written += res.modifiedCount;
			}
			ops = [];
		};

		for await (const row of cursor) {
			const target = row._derived ?? defaultId;
			if (row._derived) report.fromRule++;
			else if (defaultId) report.fromDefault++;
			else {
				report.unresolved++;
				continue;
			}
			ops.push({
				updateOne: {
					// Still empty: never overwrite, and a re-run is a no-op.
					filter: { _id: row._id, [kind.field]: { $in: [null] } },
					update: { $set: { [kind.field]: target } },
				},
			});
			if (ops.length >= BATCH) await flush();
		}
		await flush();
		kinds.push(report);
	}

	return {
		defaultLocationId: defaultId ? String(defaultId) : null,
		activeLocations: active.length,
		kinds,
	};
}
