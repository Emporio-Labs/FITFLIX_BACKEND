/**
 * "Assigned" relationships between a staff role and members.
 *
 * A chat rule set to `assigned` asks the resolver registered for the staff
 * role whether this member belongs to this staff member. A new module that
 * introduces its own assignment (a physio, a coach programme, …) only has to
 * call `registerRelationship` — the policy engine, the contact list and the
 * admin matrix pick it up from here.
 */
import mongoose from "mongoose";
import { ExpertType } from "../../models/Enums";
import ExpertAppointment from "../../models/ExpertAppointment";
import Membership from "../../models/Membership";
import NutritionistBooking from "../../models/NutritionistBooking";
import UnifiedBooking from "../../models/UnifiedBooking";
import User from "../../models/User";
import { getNutritionistClientIds } from "../nutritionistRoster.service";
import { getRosterUserIds } from "../trainerRoster.service";
import type { ChatRole } from "./people";

export interface RelationshipResolver {
	/** Member ids assigned to this staff member. */
	clientIdsOf(staffId: string): Promise<string[]>;
	/**
	 * Staff ids this member is assigned to. May include ids of other roles;
	 * callers filter by role when they load the people.
	 */
	staffIdsOf(clientId: string): Promise<string[]>;
}

const resolvers = new Map<ChatRole, RelationshipResolver>();

export const registerRelationship = (
	staffRole: ChatRole,
	resolver: RelationshipResolver,
): void => {
	resolvers.set(staffRole, resolver);
};

export const getRelationship = (
	staffRole: ChatRole,
): RelationshipResolver | undefined => resolvers.get(staffRole);

/** Staff roles a rule may be set to `assigned` for. */
export const assignableRoles = (): ChatRole[] => Array.from(resolvers.keys());

const toIds = (values: unknown[]): string[] => {
	const out = new Set<string>();
	for (const v of values) if (v) out.add(String(v));
	return Array.from(out);
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);

// ── Trainer ↔ member ─────────────────────────────────────────────────────────
// The same roster the trainer's "My Members" screen uses, so a trainer can
// message exactly the members they can already see.
registerRelationship("trainer", {
	async clientIdsOf(trainerId) {
		const [roster, viaMembership] = await Promise.all([
			getRosterUserIds(trainerId),
			Membership.distinct("user", { assignedTrainerId: oid(trainerId) }),
		]);
		return toIds([...roster, ...viaMembership]);
	},
	async staffIdsOf(clientId) {
		const [user, viaMembership, viaBooking] = await Promise.all([
			User.findById(clientId)
				.select("assignedTrainer")
				.lean<{ assignedTrainer?: unknown } | null>(),
			Membership.distinct("assignedTrainerId", { user: oid(clientId) }),
			UnifiedBooking.distinct("expertId", { userId: oid(clientId) }),
		]);
		return toIds([user?.assignedTrainer, ...viaMembership, ...viaBooking]);
	},
});

// ── Nutritionist ↔ member ────────────────────────────────────────────────────
registerRelationship("nutritionist", {
	clientIdsOf: (nutritionistId) => getNutritionistClientIds(nutritionistId),
	async staffIdsOf(clientId) {
		const [viaBooking, viaAppointment] = await Promise.all([
			NutritionistBooking.distinct("assignedNutritionistId", {
				userId: oid(clientId),
			}),
			ExpertAppointment.distinct("assignedExpertId", {
				userId: oid(clientId),
				expertType: ExpertType.Nutritionist,
			}),
		]);
		return toIds([...viaBooking, ...viaAppointment]);
	},
});

// ── Sports scientist / doctor ↔ member ───────────────────────────────────────
// No standing assignment exists for these roles; having an appointment or a
// booking with the expert is what links them.
const expertRelationship = (expertType: ExpertType): RelationshipResolver => ({
	async clientIdsOf(expertId) {
		const [viaAppointment, viaBooking] = await Promise.all([
			ExpertAppointment.distinct("userId", {
				assignedExpertId: oid(expertId),
				expertType,
			}),
			UnifiedBooking.distinct("userId", { expertId: oid(expertId) }),
		]);
		return toIds([...viaAppointment, ...viaBooking]);
	},
	async staffIdsOf(clientId) {
		const [viaAppointment, viaBooking] = await Promise.all([
			ExpertAppointment.distinct("assignedExpertId", {
				userId: oid(clientId),
				expertType,
			}),
			UnifiedBooking.distinct("expertId", { userId: oid(clientId) }),
		]);
		return toIds([...viaAppointment, ...viaBooking]);
	},
});

registerRelationship(
	"sports_scientist",
	expertRelationship(ExpertType.SportsScientist),
);
registerRelationship("doctor", expertRelationship(ExpertType.Doctor));
