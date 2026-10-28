import type mongoose from "mongoose";
import { LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";
import { logLeadActivity } from "../services/lead-activity.service";

/** Last ten digits of a phone, so "+91 98765 43210" and "9876543210" match. */
export const lastTenDigits = (phone: string | null | undefined): string =>
	String(phone ?? "")
		.replace(/\D/g, "")
		.slice(-10);

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The newest lead for this phone (or, with no usable phone, this email).
 * Returns null when neither identifies anyone.
 */
export const findExistingLead = async (identity: {
	phone?: string | null;
	email?: string | null;
}) => {
	const last10 = lastTenDigits(identity.phone);
	const email = String(identity.email ?? "").trim();
	let filter: Record<string, unknown> | null = null;
	if (last10.length === 10) {
		filter = { phone: { $regex: new RegExp(`${last10}$`) } };
	} else if (email) {
		filter = { email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } };
	}
	if (!filter) return null;
	return Lead.findOne(filter).sort({ createdAt: -1 });
};

const appendNote = (existing: string | null | undefined, note: string) => {
	const current = String(existing ?? "").trim();
	return current ? `${current}\n${note}` : note;
};

/**
 * Records that someone who may already be a lead signed up in the app.
 *
 * An existing lead keeps its name, source, status and notes — the desk may
 * already be working it. We only link the account, fill blanks, add a note
 * and the signup tags, and reopen it if it had been marked Lost. A lead is
 * created only when there is none for this person yet.
 */
export const recordAppSignupLead = async (input: {
	userId: unknown;
	name: string;
	phone?: string | null;
	email?: string | null;
	interestedIn?: string | null;
	note?: string | null;
	locationId?: unknown;
}) => {
	const tags = ["signup", "app-signup"];
	const note = input.note?.trim()
		? `Signed up in the app (${input.note.trim()})`
		: "Signed up in the app";
	const existing = await findExistingLead(input);

	if (existing) {
		const set: Record<string, unknown> = {
			notes: appendNote(existing.notes, note),
		};
		if (!existing.convertedUser) set.convertedUser = input.userId;
		if (!existing.phone && input.phone) set.phone = input.phone;
		if (!existing.email && input.email) set.email = input.email;
		if (!existing.interestedIn && input.interestedIn) {
			set.interestedIn = input.interestedIn;
		}
		if (existing.status === LeadStatus.Lost) set.status = LeadStatus.New;
		void logLeadActivity({
			leadId: existing._id,
			locationId: existing.locationId,
			type: "system",
			outcome: "app_signup",
			label: "Signed up in the app",
			note: input.note ?? "",
			statusFrom: existing.status,
			statusTo: (set.status as string) ?? existing.status,
		});
		return Lead.findByIdAndUpdate(
			existing._id,
			{ $set: set, $addToSet: { tags: { $each: tags } } },
			{ returnDocument: "after" },
		);
	}

	const created = await Lead.create({
		leadName: input.name,
		phone: input.phone ?? "",
		email: input.email ?? "",
		source: "app-signup",
		status: LeadStatus.New,
		interestedIn: input.interestedIn ?? "",
		notes: note,
		tags,
		convertedUser: input.userId as mongoose.Types.ObjectId,
		...(input.locationId
			? { locationId: input.locationId as mongoose.Types.ObjectId }
			: {}),
	});
	void logLeadActivity({
		leadId: created._id,
		locationId: created.locationId,
		type: "system",
		outcome: "created",
		label: "Signed up in the app",
		note: input.note ?? "",
		statusTo: created.status,
	});
	return created;
};
