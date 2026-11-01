// PATCH /events/:id only changes the fields it was sent, run against a stubbed
// model (no database). zod fills defaults inside .partial(), which used to
// unpublish events and reset their description and capacity on any edit.
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus } from "../src/models/Enums";
import { updateEvent } from "../src/controllers/event.controller";

function assert(condition: boolean, message: string) {
	if (!condition) {
		console.error(`  ❌ FAILED: ${message}`);
		throw new Error(message);
	}
	console.log(`  ✅ ${message}`);
}

const makeEvent = () => ({
	_id: "65f000000000000000000001",
	slug: "summit",
	title: "Summit",
	description: "Our biggest day of the year",
	eventType: "fitness_workshop",
	status: EventStatus.Published,
	reportingTime: "06:30 AM IST",
	totalCapacity: 20,
	startDate: new Date("2026-12-01T06:00:00Z"),
	endDate: new Date("2026-12-01T10:00:00Z"),
	venue: { name: "Club", address: "1 Road", city: "Hyderabad" },
	saved: false,
	async save() {
		this.saved = true;
	},
});

const patch = async (body: Record<string, unknown>) => {
	const event = makeEvent();
	(FitflixEvent as any).findOne = () => Promise.resolve(event);
	let status = 200;
	let payload: any;
	const res: any = {
		status(code: number) {
			status = code;
			return res;
		},
		json(b: unknown) {
			payload = b;
			return res;
		},
	};
	await updateEvent(
		{ params: { id: event._id }, body, user: { id: "65f0000000000000000000aa", email: "d@f.in", role: "admin" } } as any,
		res,
		(e: unknown) => {
			throw e;
		},
	);
	return { status, payload, event };
};

async function run() {
	console.log("\n🧪 Event edits keep the fields they were not sent");

	const unpublish = await patch({ status: "draft" });
	assert(unpublish.status === 200 && unpublish.event.status === EventStatus.Draft, "status-only edit changes the status");
	assert(unpublish.event.description === "Our biggest day of the year", "description is kept");
	assert(unpublish.event.eventType === "fitness_workshop", "event type is kept");
	assert(unpublish.event.reportingTime === "06:30 AM IST", "reporting time is kept");
	assert(unpublish.event.totalCapacity === 20, "capacity is kept");

	const retitle = await patch({ tagline: "New tagline" });
	assert(retitle.event.status === EventStatus.Published, "editing the tagline does not unpublish the event");
	assert((retitle.event as any).tagline === "New tagline", "the tagline is updated");

	const capacity = await patch({ totalCapacity: 50 });
	assert(capacity.event.totalCapacity === 50, "a sent field is still applied");

	console.log("\n✅ All event update tests passed");
}

run().then(
	() => process.exit(0),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
