import mongoose from "mongoose";
import { syncSessionsForClass } from "../controllers/class.controller";
import Bookings from "../models/Bookings";
import Class from "../models/Class";
import ClassWaitlist from "../models/ClassWaitlist";
import {
	CreditTransactionSource,
	NotificationChannel,
	NotificationKind,
	WaitlistStatus,
} from "../models/Enums";
import ScheduledSession from "../models/ScheduledSession";
import {
	CreditServiceError,
	consumeCredits,
	mapCreditServiceError,
	refundCreditsBySource,
} from "../utils/credit.service";
import {
	evaluateBookingRules,
	parseInTimezone,
} from "./booking-rules-engine.service";
import { allocateSeatAtomic, releaseSeatAtomic } from "./capacity-engine.service";
import { notify } from "./notification.service";
import { emitToFrontDesk } from "./realtime.service";

const SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SESSION_SCAN_LIMIT = 200;

export interface WaitlistJoinResult {
	success: boolean;
	statusCode: 200 | 201 | 400 | 403 | 404 | 409 | 500;
	message: string;
	code?: string;
	position?: number;
	totalWaiting?: number;
	waitlistEntry?: any;
	details?: any;
}

export interface WaitlistLeaveResult {
	success: boolean;
	statusCode: 200 | 400 | 404;
	message: string;
	waitlistCount?: number;
}

export interface WaitlistPromotionResult {
	promoted: boolean;
	promotedUserId?: string;
	booking?: any;
	skippedCount: number;
	skippedUsers: Array<{ userId: string; reason: string }>;
}

/**
 * Finds the next upcoming session for a class (including FULL sessions, since
 * waitlist applies specifically to full upcoming sessions).
 */
async function findNextUpcomingSessionForWaitlist(
	targetClass: any,
	now: Date = new Date(),
): Promise<any | null> {
	const classTimezone = (targetClass as any).timezone || "Asia/Kolkata";
	const lookbackFrom = new Date(now.getTime() - SESSION_LOOKBACK_MS);
	lookbackFrom.setUTCHours(0, 0, 0, 0);

	const candidates = await ScheduledSession.find({
		classId: targetClass._id,
		status: { $in: ["SCHEDULED", "FULL"] },
		sessionDate: { $gte: lookbackFrom },
	})
		.sort({ sessionDate: 1, startTime: 1 })
		.limit(SESSION_SCAN_LIMIT);

	for (const candidate of candidates) {
		const startsAt = parseInTimezone(
			new Date(candidate.sessionDate),
			candidate.startTime,
			classTimezone,
		);
		if (startsAt.getTime() > now.getTime()) {
			return candidate;
		}
	}

	return null;
}

/**
 * Resolves a sessionId or classId to a concrete ScheduledSession document.
 */
export async function resolveSessionForWaitlist(params: {
	sessionId?: string;
	classId?: string;
	now?: Date;
}): Promise<{ session: any | null; targetClass: any | null }> {
	const now = params.now || new Date();
	let session: any = null;
	const candidateSessionId = params.sessionId || params.classId;

	if (
		candidateSessionId &&
		mongoose.Types.ObjectId.isValid(candidateSessionId)
	) {
		session = await ScheduledSession.findById(candidateSessionId);
	}

	let targetClass: any = null;
	if (session) {
		targetClass = await Class.findById(session.classId);
	} else {
		const lookupClassId = params.classId || params.sessionId;
		if (lookupClassId) {
			targetClass = await Class.findById(lookupClassId);
			if (
				targetClass &&
				(targetClass as any).status !== "INACTIVE" &&
				(targetClass as any).isPublished !== false
			) {
				session = await findNextUpcomingSessionForWaitlist(targetClass, now);
				if (!session) {
					await syncSessionsForClass(targetClass);
					session = await findNextUpcomingSessionForWaitlist(targetClass, now);
				}
			}
		}
	}

	return { session, targetClass };
}

/**
 * Computes 1-based FIFO queue position and total WAITING count for a waitlist entry.
 */
export async function computeWaitlistPosition(
	sessionId: string,
	joinedAt: Date,
	entryId: mongoose.Types.ObjectId | string,
): Promise<{ position: number; totalWaiting: number }> {
	const objId =
		typeof entryId === "string" ? new mongoose.Types.ObjectId(entryId) : entryId;

	const [aheadCount, totalWaiting] = await Promise.all([
		ClassWaitlist.countDocuments({
			sessionId,
			status: WaitlistStatus.Waiting,
			$or: [
				{ joinedAt: { $lt: joinedAt } },
				{ joinedAt, _id: { $lt: objId } },
			],
		}),
		ClassWaitlist.countDocuments({
			sessionId,
			status: WaitlistStatus.Waiting,
		}),
	]);

	return {
		position: aheadCount + 1,
		totalWaiting: Math.max(totalWaiting, aheadCount + 1),
	};
}

/**
 * Enrolls a member onto a full class session's waitlist.
 */
export async function joinClassWaitlist(params: {
	userId: string;
	sessionId?: string;
	classId?: string;
	now?: Date;
}): Promise<WaitlistJoinResult> {
	const now = params.now || new Date();
	const { session, targetClass } = await resolveSessionForWaitlist({
		sessionId: params.sessionId,
		classId: params.classId,
		now,
	});

	if (!targetClass) {
		return {
			success: false,
			statusCode: 404,
			message: "Class not found",
			code: "CLASS_NOT_FOUND",
		};
	}

	if (
		(targetClass as any).status === "INACTIVE" ||
		(targetClass as any).isPublished === false
	) {
		return {
			success: false,
			statusCode: 403,
			message: "This class is no longer available",
			code: "CLASS_INACTIVE",
		};
	}

	if (!(targetClass as any).enableWaitlist) {
		return {
			success: false,
			statusCode: 403,
			message: "Waitlist is not enabled for this class",
			code: "WAITLIST_DISABLED",
		};
	}

	if (!session) {
		return {
			success: false,
			statusCode: 404,
			message: "No upcoming session is scheduled for this class",
			code: "SESSION_NOT_FOUND",
		};
	}

	if (session.status === "CANCELLED" || session.status === "COMPLETED") {
		return {
			success: false,
			statusCode: 400,
			message: `Cannot join waitlist for a ${session.status.toLowerCase()} session`,
			code: `SESSION_${session.status}`,
		};
	}

	const resolvedSessionId = session._id.toString();
	const resolvedClassId = targetClass._id.toString();

	// Evaluate standard booking rules (active user, active membership, booking window open/not closed)
	const rulesEval = await evaluateBookingRules({
		userId: params.userId,
		classId: resolvedClassId,
		sessionId: resolvedSessionId,
		sessionDate: session.sessionDate,
		startTime: session.startTime,
		now,
	});

	if (!rulesEval.allowed) {
		return {
			success: false,
			statusCode: rulesEval.statusCode || 403,
			message: rulesEval.message || "Booking rules check failed",
			details: rulesEval.details,
		};
	}

	const userObjId = new mongoose.Types.ObjectId(params.userId);

	// Prevent joining waitlist if already booked into this session
	const existingBooking = await Bookings.findOne({
		user: userObjId,
		sessionId: resolvedSessionId,
		status: { $nin: ["Cancelled", "CANCELLED", 2] },
	});

	if (existingBooking) {
		return {
			success: false,
			statusCode: 409,
			message: "Member is already registered for this class session",
			code: "ALREADY_BOOKED",
		};
	}

	// Only allow waitlist when the session is actually full
	if (session.remainingCapacity > 0 && session.status !== "FULL") {
		return {
			success: false,
			statusCode: 409,
			message:
				"Seats are still available for this session — please book directly",
			code: "SEATS_AVAILABLE",
		};
	}

	// Idempotent check: if user is already WAITING, return their current queue position
	const existingWaiting = await ClassWaitlist.findOne({
		sessionId: resolvedSessionId,
		user: userObjId,
		status: WaitlistStatus.Waiting,
	});

	if (existingWaiting) {
		const { position, totalWaiting } = await computeWaitlistPosition(
			resolvedSessionId,
			existingWaiting.joinedAt,
			existingWaiting._id,
		);
		return {
			success: true,
			statusCode: 200,
			message: `You are #${position} on the waitlist`,
			position,
			totalWaiting,
			waitlistEntry: {
				id: existingWaiting._id.toString(),
				sessionId: resolvedSessionId,
				classId: resolvedClassId,
				userId: params.userId,
				status: existingWaiting.status,
				position,
				totalWaiting,
				joinedAt: existingWaiting.joinedAt,
			},
		};
	}

	const joinedAt = new Date();
	const entry = await ClassWaitlist.create({
		sessionId: resolvedSessionId,
		classId: resolvedClassId,
		user: userObjId,
		status: WaitlistStatus.Waiting,
		joinedAt,
	});

	const { position, totalWaiting } = await computeWaitlistPosition(
		resolvedSessionId,
		entry.joinedAt,
		entry._id,
	);

	try {
		emitToFrontDesk("waitlist_updated", {
			action: "joined",
			sessionId: resolvedSessionId,
			classId: resolvedClassId,
			userId: params.userId,
			position,
			totalWaiting,
		});
	} catch (_) {
		// Non-fatal socket emit
	}

	return {
		success: true,
		statusCode: 201,
		message: `Joined waitlist (#${position} in queue)`,
		position,
		totalWaiting,
		waitlistEntry: {
			id: entry._id.toString(),
			sessionId: resolvedSessionId,
			classId: resolvedClassId,
			userId: params.userId,
			status: entry.status,
			position,
			totalWaiting,
			joinedAt: entry.joinedAt,
		},
	};
}

/**
 * Removes a member from a session's waitlist.
 */
export async function leaveClassWaitlist(params: {
	userId: string;
	sessionId?: string;
	classId?: string;
}): Promise<WaitlistLeaveResult> {
	const userObjId = new mongoose.Types.ObjectId(params.userId);
	const rawId = params.sessionId || params.classId || "";

	// Try direct match on sessionId, classId, or waitlist entry _id first
	let entry = await ClassWaitlist.findOne({
		user: userObjId,
		status: WaitlistStatus.Waiting,
		$or: [
			{ sessionId: rawId },
			{ classId: rawId },
			...(mongoose.Types.ObjectId.isValid(rawId)
				? [{ _id: new mongoose.Types.ObjectId(rawId) }]
				: []),
		],
	});

	if (!entry) {
		const { session } = await resolveSessionForWaitlist({
			sessionId: params.sessionId,
			classId: params.classId,
		});
		if (session) {
			entry = await ClassWaitlist.findOne({
				user: userObjId,
				sessionId: session._id.toString(),
				status: WaitlistStatus.Waiting,
			});
		}
	}

	if (!entry) {
		return {
			success: false,
			statusCode: 404,
			message: "Active waitlist entry not found",
		};
	}

	entry.status = WaitlistStatus.Left;
	entry.leftAt = new Date();
	await entry.save();

	const remainingWaitlistCount = await ClassWaitlist.countDocuments({
		sessionId: entry.sessionId,
		status: WaitlistStatus.Waiting,
	});

	try {
		emitToFrontDesk("waitlist_updated", {
			action: "left",
			sessionId: entry.sessionId,
			classId: entry.classId,
			userId: params.userId,
			totalWaiting: remainingWaitlistCount,
		});
	} catch (_) {
		// Non-fatal
	}

	return {
		success: true,
		statusCode: 200,
		message: "Removed from waitlist",
		waitlistCount: remainingWaitlistCount,
	};
}

/**
 * Automatically promotes the first eligible member from the FIFO waitlist when
 * a seat opens up on `sessionId`.
 *
 * - Deducts credits atomically (`consumeCredits`).
 * - Anyone without enough credits is marked `SKIPPED_INSUFFICIENT_CREDITS`,
 *   notified why, and skipped in favor of the next person in queue.
 * - First person with enough credits is booked (`Bookings.create`), charged,
 *   marked `PROMOTED`, and notified immediately.
 */
export async function promoteNextFromWaitlist(
	sessionId: string,
	now: Date = new Date(),
): Promise<WaitlistPromotionResult> {
	const skippedUsers: Array<{ userId: string; reason: string }> = [];

	if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
		return { promoted: false, skippedCount: 0, skippedUsers };
	}

	const session = await ScheduledSession.findById(sessionId);
	if (
		!session ||
		session.status === "CANCELLED" ||
		session.status === "COMPLETED"
	) {
		return { promoted: false, skippedCount: 0, skippedUsers };
	}

	const targetClass = await Class.findById(session.classId);
	if (
		!targetClass ||
		!(targetClass as any).enableWaitlist ||
		(targetClass as any).status === "INACTIVE" ||
		(targetClass as any).isPublished === false
	) {
		return { promoted: false, skippedCount: 0, skippedUsers };
	}

	// Do not auto-promote once the session has already started
	const classTimezone = (targetClass as any).timezone || "Asia/Kolkata";
	const startsAt = parseInTimezone(
		new Date(session.sessionDate),
		session.startTime,
		classTimezone,
	);
	if (now.getTime() >= startsAt.getTime()) {
		return { promoted: false, skippedCount: 0, skippedUsers };
	}

	const resolvedSessionId = session._id.toString();
	const resolvedClassId = targetClass._id.toString();
	const isFree =
		(targetClass as any)?.bookingRequirement === "free" ||
		Number((targetClass as any)?.creditCost) === 0;
	const creditCost = isFree ? 0 : Number((targetClass as any)?.creditCost) || 1;

	// Guard against infinite loops by bounding iterations to a generous max
	const maxCandidates = 100;
	for (let i = 0; i < maxCandidates; i++) {
		const candidate = await ClassWaitlist.findOne({
			sessionId: resolvedSessionId,
			status: WaitlistStatus.Waiting,
		}).sort({ joinedAt: 1, _id: 1 });

		if (!candidate) {
			break;
		}

		const candidateUserId = candidate.user.toString();

		// If user already holds an active booking for this session, mark promoted and move on
		const alreadyBooked = await Bookings.findOne({
			user: candidate.user,
			sessionId: resolvedSessionId,
			status: { $nin: ["Cancelled", "CANCELLED", 2] },
		});

		if (alreadyBooked) {
			candidate.status = WaitlistStatus.Promoted;
			candidate.promotedAt = now;
			candidate.promotedBookingId = alreadyBooked._id;
			await candidate.save();
			continue;
		}

		// Atomically allocate the open seat
		const seatAllocation = await allocateSeatAtomic(resolvedSessionId);
		if (!seatAllocation.success) {
			// Seat was taken concurrently or no seats remain
			break;
		}

		const bookingId = new mongoose.Types.ObjectId();

		// Attempt credit deduction if class requires credits
		if (creditCost > 0) {
			try {
				await consumeCredits({
					userId: candidateUserId,
					amount: creditCost,
					sourceType: CreditTransactionSource.Booking,
					sourceId: bookingId.toString(),
					reason: `Waitlist auto-booking for ${targetClass.name} (${resolvedClassId})`,
					locationId: (targetClass as any).locationId
						? String((targetClass as any).locationId)
						: undefined,
				});
			} catch (error) {
				// Release the seat immediately so the next person in queue can be promoted
				await releaseSeatAtomic(resolvedSessionId);

				const skipReason =
					error instanceof CreditServiceError
						? mapCreditServiceError(error).message
						: "Insufficient credits to complete automatic waitlist booking";

				candidate.status = WaitlistStatus.SkippedInsufficientCredits;
				candidate.skippedAt = now;
				candidate.skipReason = skipReason;
				await candidate.save();

				skippedUsers.push({ userId: candidateUserId, reason: skipReason });

				await notify({
					userId: candidateUserId,
					kind: NotificationKind.WaitlistSkippedInsufficientCredits,
					title: "Waitlist Spot Skipped — Insufficient Credits",
					body: `A spot opened in ${targetClass.name}, but you were skipped because ${ creditCost } credit${creditCost === 1 ? "" : "s"} ${creditCost === 1 ? "is" : "are"} required (${skipReason}). Top up credits to rejoin.`,
					data: {
						sessionId: resolvedSessionId,
						classId: resolvedClassId,
						className: targetClass.name,
						creditCost: String(creditCost),
						reason: skipReason,
					},
					channels: [
						NotificationChannel.InApp,
						NotificationChannel.Push,
						NotificationChannel.Socket,
					],
				});

				// Continue loop to try the next person waiting in the queue
				continue;
			}
		}

		// Create confirmed booking for the promoted user
		try {
			const booking = await Bookings.create({
				_id: bookingId,
				user: candidate.user,
				sessionId: resolvedSessionId,
				classId: resolvedClassId,
				bookingDate: session.sessionDate,
				startTime: session.startTime,
				endTime: session.endTime,
				status: "Confirmed",
				creditCostSnapshot: creditCost,
				creditsBypassed: false,
				// FX-18 — stamp the branch (from the class) for staff scoping.
				...((session as any).locationId ?? (targetClass as any)?.locationId
					? {
							locationId:
								(session as any).locationId ??
								(targetClass as any)?.locationId,
						}
					: {}),
			});

			candidate.status = WaitlistStatus.Promoted;
			candidate.promotedAt = now;
			candidate.promotedBookingId = booking._id;
			await candidate.save();

			await notify({
				userId: candidateUserId,
				kind: NotificationKind.WaitlistPromoted,
				title: "You're In! Booked from Waitlist",
				body:
					creditCost > 0
						? `A spot opened in ${targetClass.name}! You have been automatically booked and charged ${creditCost} credit${creditCost === 1 ? "" : "s"}.`
						: `A spot opened in ${targetClass.name}! You have been automatically booked from the waitlist.`,
				data: {
					appointmentId: booking._id.toString(),
					bookingId: booking._id.toString(),
					sessionId: resolvedSessionId,
					classId: resolvedClassId,
					className: targetClass.name,
				},
				channels: [
					NotificationChannel.InApp,
					NotificationChannel.Push,
					NotificationChannel.Socket,
				],
			});

			try {
				emitToFrontDesk("waitlist_updated", {
					action: "promoted",
					sessionId: resolvedSessionId,
					classId: resolvedClassId,
					promotedUserId: candidateUserId,
					bookingId: booking._id.toString(),
					skippedCount: skippedUsers.length,
				});
			} catch (_) {
				// Non-fatal
			}

			return {
				promoted: true,
				promotedUserId: candidateUserId,
				booking,
				skippedCount: skippedUsers.length,
				skippedUsers,
			};
		} catch (bookingErr) {
			await releaseSeatAtomic(resolvedSessionId);
			if (creditCost > 0) {
				await refundCreditsBySource({
					userId: candidateUserId,
					sourceType: CreditTransactionSource.Booking,
					sourceId: bookingId.toString(),
					reason: `Rollback: waitlist promotion booking write failed for session ${resolvedSessionId}`,
				}).catch(() => null);
			}
			throw bookingErr;
		}
	}

	if (skippedUsers.length > 0) {
		try {
			emitToFrontDesk("waitlist_updated", {
				action: "skipped",
				sessionId: resolvedSessionId,
				classId: resolvedClassId,
				skippedCount: skippedUsers.length,
			});
		} catch (_) {
			// Non-fatal
		}
	}

	return {
		promoted: false,
		skippedCount: skippedUsers.length,
		skippedUsers,
	};
}

/**
 * Batch-computes waitlist metadata (`waitlistCount`, `myWaitlistPosition`,
 * `myWaitlistStatus`, `myWaitlistSkipReason`) for a list of sessions.
 */
export async function buildWaitlistMetadataBySessionId(
	sessionIds: string[],
	userId?: string,
): Promise<
	Map<
		string,
		{
			waitlistCount: number;
			myWaitlistPosition: number | null;
			myWaitlistStatus: string | null;
			myWaitlistSkipReason: string | null;
		}
	>
> {
	const result = new Map<
		string,
		{
			waitlistCount: number;
			myWaitlistPosition: number | null;
			myWaitlistStatus: string | null;
			myWaitlistSkipReason: string | null;
		}
	>();

	if (sessionIds.length === 0) return result;

	const waitingEntries = await ClassWaitlist.find({
		sessionId: { $in: sessionIds },
		status: WaitlistStatus.Waiting,
	})
		.sort({ joinedAt: 1, _id: 1 })
		.select("_id sessionId user joinedAt status")
		.lean();

	const waitingBySession = new Map<string, Array<any>>();
	for (const entry of waitingEntries) {
		const sid = String(entry.sessionId);
		const list = waitingBySession.get(sid) || [];
		list.push(entry);
		waitingBySession.set(sid, list);
	}

	const userLatestNonWaiting = new Map<
		string,
		{ status: string; skipReason: string | null }
	>();
	if (userId && mongoose.Types.ObjectId.isValid(userId)) {
		const userEntries = await ClassWaitlist.find({
			sessionId: { $in: sessionIds },
			user: new mongoose.Types.ObjectId(userId),
			status: {
				$in: [
					WaitlistStatus.SkippedInsufficientCredits,
					WaitlistStatus.Promoted,
				],
			},
		})
			.sort({ updatedAt: -1 })
			.select("sessionId status skipReason")
			.lean();

		for (const ue of userEntries) {
			const sid = String(ue.sessionId);
			if (!userLatestNonWaiting.has(sid)) {
				userLatestNonWaiting.set(sid, {
					status: String(ue.status),
					skipReason: ue.skipReason ? String(ue.skipReason) : null,
				});
			}
		}
	}

	for (const sid of sessionIds) {
		const queue = waitingBySession.get(sid) || [];
		let myPosition: number | null = null;
		let myStatus: string | null = null;
		let mySkipReason: string | null = null;

		if (userId) {
			const idx = queue.findIndex((e) => String(e.user) === String(userId));
			if (idx !== -1) {
				myPosition = idx + 1;
				myStatus = WaitlistStatus.Waiting;
			} else {
				const nonWaiting = userLatestNonWaiting.get(sid);
				if (nonWaiting) {
					myStatus = nonWaiting.status;
					mySkipReason = nonWaiting.skipReason;
				}
			}
		}

		result.set(sid, {
			waitlistCount: queue.length,
			myWaitlistPosition: myPosition,
			myWaitlistStatus: myStatus,
			myWaitlistSkipReason: mySkipReason,
		});
	}

	return result;
}

/**
 * Returns waitlist entries for a member (with live queue positions).
 */
export async function getMyWaitlistEntries(userId: string) {
	const userObjId = new mongoose.Types.ObjectId(userId);
	const entries = await ClassWaitlist.find({
		user: userObjId,
		status: {
			$in: [
				WaitlistStatus.Waiting,
				WaitlistStatus.Promoted,
				WaitlistStatus.SkippedInsufficientCredits,
			],
		},
	})
		.populate(
			"classId",
			"name description instructor mode sessionType creditCost durationMinutes locationAddress enableWaitlist imageUrl format",
		)
		.populate(
			"sessionId",
			"sessionDate startTime endTime status capacity currentBookings remainingCapacity",
		)
		.sort({ joinedAt: -1 })
		.lean();

	const enriched = await Promise.all(
		entries.map(async (entry: any) => {
			const rawSessionId =
				typeof entry.sessionId === "object" && entry.sessionId
					? String(entry.sessionId._id)
					: String(entry.sessionId);

			let position: number | null = null;
			let totalWaiting = 0;

			if (entry.status === WaitlistStatus.Waiting) {
				const posInfo = await computeWaitlistPosition(
					rawSessionId,
					new Date(entry.joinedAt),
					entry._id,
				);
				position = posInfo.position;
				totalWaiting = posInfo.totalWaiting;
			} else {
				totalWaiting = await ClassWaitlist.countDocuments({
					sessionId: rawSessionId,
					status: WaitlistStatus.Waiting,
				});
			}

			return {
				...entry,
				id: String(entry._id),
				sessionIdString: rawSessionId,
				position,
				totalWaiting,
			};
		}),
	);

	return enriched;
}

/**
 * Returns waitlist entries for Front Desk / Admin, enriched with 1-based queue
 * positions per session.
 */
export async function getWaitlistForAdmin(filters: {
	classId?: string;
	sessionId?: string;
	status?: string;
	search?: string;
}) {
	const query: Record<string, unknown> = {};
	if (filters.classId) query.classId = filters.classId;
	if (filters.sessionId) query.sessionId = filters.sessionId;
	if (filters.status && filters.status.toLowerCase() !== "all") {
		query.status = filters.status.toUpperCase();
	} else {
		// By default include active waiting + promoted + skipped (exclude LEFT unless requested)
		query.status = {
			$in: [
				WaitlistStatus.Waiting,
				WaitlistStatus.Promoted,
				WaitlistStatus.SkippedInsufficientCredits,
			],
		};
	}

	let entries = await ClassWaitlist.find(query)
		.populate("user", "username email phone")
		.populate(
			"classId",
			"name instructor mode sessionType creditCost scheduleInfo enableWaitlist imageUrl format",
		)
		.populate(
			"sessionId",
			"sessionDate startTime endTime status capacity currentBookings remainingCapacity deliveryType",
		)
		.sort({ joinedAt: 1, _id: 1 })
		.lean();

	if (filters.search && filters.search.trim().length > 0) {
		const q = filters.search.trim().toLowerCase();
		entries = entries.filter((e: any) => {
			const username = e.user?.username?.toLowerCase() || "";
			const email = e.user?.email?.toLowerCase() || "";
			const phone = e.user?.phone?.toLowerCase() || "";
			const className = e.classId?.name?.toLowerCase() || "";
			return (
				username.includes(q) ||
				email.includes(q) ||
				phone.includes(q) ||
				className.includes(q)
			);
		});
	}

	// Compute 1-based queue position per sessionId among WAITING entries
	const sessionIds = [
		...new Set(
			entries.map((e: any) =>
				typeof e.sessionId === "object" && e.sessionId
					? String(e.sessionId._id)
					: String(e.sessionId),
			),
		),
	];

	const allWaitingForSessions = await ClassWaitlist.find({
		sessionId: { $in: sessionIds },
		status: WaitlistStatus.Waiting,
	})
		.sort({ joinedAt: 1, _id: 1 })
		.select("_id sessionId")
		.lean();

	const positionByEntryId = new Map<string, number>();
	const totalWaitingBySessionId = new Map<string, number>();

	for (const w of allWaitingForSessions) {
		const sid = String(w.sessionId);
		const nextPos = (totalWaitingBySessionId.get(sid) ?? 0) + 1;
		totalWaitingBySessionId.set(sid, nextPos);
		positionByEntryId.set(String(w._id), nextPos);
	}

	return entries.map((e: any) => {
		const sid =
			typeof e.sessionId === "object" && e.sessionId
				? String(e.sessionId._id)
				: String(e.sessionId);
		const entryId = String(e._id);
		return {
			...e,
			id: entryId,
			position:
				e.status === WaitlistStatus.Waiting
					? (positionByEntryId.get(entryId) ?? null)
					: null,
			totalWaiting: totalWaitingBySessionId.get(sid) ?? 0,
		};
	});
}
