import { AppointmentMode } from "../models/Enums";

/**
 * `AppointmentMode` carries three values but only means two things: `OFFLINE`
 * is a legacy alias for `IN_PERSON` that predates the rename and still shows up
 * on old documents and old clients (the Flutter `AppointmentModeX.fromBackend`
 * folds it on its side too). Availability now depends on the mode a member
 * picked, so a third value leaking into that logic would silently return no
 * times for anyone stored as `OFFLINE`.
 *
 * Everything that reads or writes a mode goes through here first.
 */
export type CanonicalAppointmentMode =
	| AppointmentMode.IN_PERSON
	| AppointmentMode.ONLINE;

export const CANONICAL_APPOINTMENT_MODES: CanonicalAppointmentMode[] = [
	AppointmentMode.IN_PERSON,
	AppointmentMode.ONLINE,
];

/** Fold any accepted spelling to one of the two canonical values. */
export const normalizeAppointmentMode = (
	value: unknown,
): CanonicalAppointmentMode | null => {
	if (typeof value !== "string") return null;
	const upper = value.trim().toUpperCase();
	if (upper === AppointmentMode.ONLINE) return AppointmentMode.ONLINE;
	if (upper === AppointmentMode.IN_PERSON || upper === AppointmentMode.OFFLINE) {
		return AppointmentMode.IN_PERSON;
	}
	return null;
};

/**
 * Same fold, but never returns null — for write paths that already have a
 * default in mind. Unrecognised input falls back rather than throwing, since
 * the schema enum is the real gate.
 */
export const normalizeAppointmentModeOr = (
	value: unknown,
	fallback: CanonicalAppointmentMode,
): CanonicalAppointmentMode => normalizeAppointmentMode(value) ?? fallback;

/** De-duplicate a supportedModes list down to canonical values, order-stable. */
export const normalizeSupportedModes = (
	values: unknown,
): CanonicalAppointmentMode[] => {
	if (!Array.isArray(values)) return [...CANONICAL_APPOINTMENT_MODES];
	const seen = new Set<CanonicalAppointmentMode>();
	for (const raw of values) {
		const mode = normalizeAppointmentMode(raw);
		if (mode) seen.add(mode);
	}
	// An expert who supports nothing can never be booked — that is almost
	// always a client sending garbage rather than a deliberate opt-out, and
	// `isActive: false` is the real kill switch. Fall back to both.
	if (seen.size === 0) return [...CANONICAL_APPOINTMENT_MODES];
	return CANONICAL_APPOINTMENT_MODES.filter((m) => seen.has(m));
};
