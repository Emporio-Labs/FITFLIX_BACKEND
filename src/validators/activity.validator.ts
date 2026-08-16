import z from "zod";
import { BEHAVIOUR_EVENTS } from "../models/BehaviourEvent";

/**
 * Params are open-ended by design — new event detail should never need a
 * migration — but not unbounded. A Mixed field with no ceiling is how this
 * collection would quietly become the largest in the database, so depth is
 * flat, values are scalars, and both the key count and string length are
 * capped here at the edge rather than in the schema.
 */
const paramValue = z.union([
	z.string().max(200),
	z.number().finite(),
	z.boolean(),
]);

const params = z
	.record(z.string().max(40), paramValue)
	.refine((p) => Object.keys(p).length <= 12, "At most 12 params per event");

/**
 * `occurredAt` is client-supplied because batching means events are sent
 * minutes after they happen, and ordering by receipt time would scramble the
 * sequence the summary is meant to read as a story. Clamped below so a wrong
 * device clock cannot park an event in the far future and pin itself to the
 * top of every salesperson's view.
 */
const eventSchema = z.object({
	event: z.enum(BEHAVIOUR_EVENTS),
	occurredAt: z.coerce.date(),
	params: params.optional(),
	sessionId: z.string().trim().max(64).optional(),
});

/** How far ahead of server time a client timestamp may sit before it is clamped. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const recordActivitySchema = z.object({
	// A batch, because per-tap requests would cost battery and would still
	// arrive out of order. Capped so one client cannot post a million rows.
	events: z.array(eventSchema).min(1).max(100),
});

export type RecordActivityInput = z.infer<typeof recordActivitySchema>;
