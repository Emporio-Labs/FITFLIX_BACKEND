import mongoose from "mongoose";
import { AlertStatus } from "../models/Enums";
import ClassModel from "../models/Class";
import GymVisit from "../models/GymVisit";
import Invoice from "../models/Invoice";
import Location from "../models/Location";
import OperationalAlert from "../models/OperationalAlert";
import ScheduledSession from "../models/ScheduledSession";
import User from "../models/User";
import { getIO } from "./realtime.service";
import {
	formatDateInZone,
	formatTimeInZone,
	normalizeTimeZone,
	zonedDateTimeToInstant,
} from "../utils/timezone.util";

export interface BranchBoardSessionItem {
	id: string;
	className: string;
	instructorName: string;
	startTime: string;
	endTime: string;
	status: string;
	roomStatus: string;
	isLive: boolean;
	capacity: number;
	bookingCount: number;
}

export interface BranchBoardStaffItem {
	id: string;
	name: string;
	role: string;
	isOnline: boolean;
}

export interface BranchBoardAlertItem {
	id: string;
	type: string;
	severity: string;
	status: string;
	title: string;
	message: string;
	createdAt: string;
}

export interface BranchBoardItem {
	branch: {
		id: string;
		name: string;
		code: string;
		timezone: string;
		isActive: boolean;
		phone?: string;
	};
	sessions: {
		liveCount: number;
		upcomingCount: number;
		totalToday: number;
		items: BranchBoardSessionItem[];
	};
	checkIns: {
		todayCount: number;
		currentlyInGym: number;
	};
	staffOnDuty: {
		count: number;
		members: BranchBoardStaffItem[];
	};
	alerts: {
		openCount: number;
		criticalCount: number;
		warningCount: number;
		recentAlerts: BranchBoardAlertItem[];
	};
	revenue: {
		todayTotal: number;
		currency: string;
		invoiceCount: number;
	};
}

export interface BranchBoardResponse {
	asOf: string;
	branches: BranchBoardItem[];
}

/**
 * FX-43.1: Calculates live operational metrics for branches.
 * For each branch: live & upcoming sessions, today's check-ins, staff on duty,
 * open alerts, and today's revenue.
 */
export async function getBranchBoardData(
	branchIds?: Array<string | mongoose.Types.ObjectId>,
	now: Date = new Date(),
): Promise<BranchBoardResponse> {
	const query: Record<string, unknown> = { isActive: true };
	if (Array.isArray(branchIds) && branchIds.length > 0) {
		query._id = { $in: branchIds };
	}

	const branches = await Location.find(query).lean();
	const boardItems: BranchBoardItem[] = [];

	const io = getIO();

	for (const branch of branches) {
		const branchIdStr = branch._id.toString();
		const tz = normalizeTimeZone(branch.timezone);
		const todayStr = formatDateInZone(now, tz);
		const currentHHmm = formatTimeInZone(now, tz);

		const startOfDay = zonedDateTimeToInstant(todayStr, "00:00", tz);
		const endOfDay = zonedDateTimeToInstant(todayStr, "23:59", tz);

		// 1. Sessions: Live & Upcoming
		const todaySessions = await ScheduledSession.find({
			sessionDate: {
				$gte: new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000),
				$lte: new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000),
			},
			status: { $ne: "CANCELLED" },
		})
			.lean()
			.limit(100);

		// Filter for this branch via class lookup or direct locationId
		const classIds = todaySessions.map((s) => s.classId);
		const classes = await ClassModel.find({
			_id: { $in: classIds },
			locationId: branch._id,
		})
			.select("name instructor locationId")
			.lean();
		const classMap = new Map(classes.map((c) => [c._id.toString(), c]));

		const sessionItems: BranchBoardSessionItem[] = [];
		let liveCount = 0;
		let upcomingCount = 0;

		for (const session of todaySessions) {
			const cls = classMap.get(session.classId.toString());
			if (!cls) continue; // not this branch

			const startTime = session.startTime || "00:00";
			const endTime = session.endTime || "23:59";
			const isLive =
				session.roomStatus === "IN_PROGRESS" ||
				(session.hostLiveAt != null &&
					startTime <= currentHHmm &&
					endTime >= currentHHmm);
			const isUpcoming = startTime > currentHHmm && !isLive;

			if (isLive) liveCount++;
			else if (isUpcoming) upcomingCount++;

			sessionItems.push({
				id: session._id.toString(),
				className: cls.name || "Group Class",
				instructorName: cls.instructor || "Staff",
				startTime,
				endTime,
				status: session.status,
				roomStatus: session.roomStatus || "SCHEDULED",
				isLive,
				capacity: session.capacity || 0,
				bookingCount: session.bookingCount || 0,
			});
		}

		// Sort sessions: live first, then chronological by startTime
		sessionItems.sort((a, b) => {
			if (a.isLive && !b.isLive) return -1;
			if (!a.isLive && b.isLive) return 1;
			return a.startTime.localeCompare(b.startTime);
		});

		// 2. Check-ins: Today's check-ins & active in gym
		const [todayCheckIns, activeCheckIns] = await Promise.all([
			GymVisit.countDocuments({
				locationId: branch._id,
				checkInAt: { $gte: startOfDay, $lte: endOfDay },
			}),
			GymVisit.countDocuments({
				locationId: branch._id,
				checkInAt: { $gte: startOfDay, $lte: endOfDay },
				checkOutAt: null,
			}),
		]);

		// 3. Staff on duty: connected sockets & online users
		const staffMembers: BranchBoardStaffItem[] = [];
		const staffSeen = new Set<string>();

		if (io) {
			const branchRoom = io.sockets.adapter.rooms.get(`branch:${branchIdStr}`);
			if (branchRoom) {
				for (const socketId of branchRoom) {
					const socket = io.sockets.sockets.get(socketId);
					if (!socket) continue;
					const u = socket.data?.user as { id?: string; role?: string; name?: string } | undefined;
					if (u?.id && !staffSeen.has(u.id)) {
						staffSeen.add(u.id);
						staffMembers.push({
							id: u.id,
							name: u.name || "Staff Member",
							role: u.role || "frontdesk",
							isOnline: true,
						});
					}
				}
			}

			// Also inspect frontdesk room for this branch
			const frontdeskRoom = io.sockets.adapter.rooms.get("frontdesk");
			if (frontdeskRoom) {
				for (const socketId of frontdeskRoom) {
					const socket = io.sockets.sockets.get(socketId);
					if (!socket) continue;
					const u = socket.data?.user as { id?: string; role?: string; name?: string; branchId?: string } | undefined;
					const socketBranch = socket.handshake.auth?.branchId || socket.handshake.query?.branchId || u?.branchId;
					if (u?.id && !staffSeen.has(u.id) && String(socketBranch) === branchIdStr) {
						staffSeen.add(u.id);
						staffMembers.push({
							id: u.id,
							name: u.name || "Frontdesk Staff",
							role: u.role || "frontdesk",
							isOnline: true,
						});
					}
				}
			}
		}

		// Fallback: if no active sockets, query users assigned to this branch with staff role
		if (staffMembers.length === 0) {
			const fallbackStaff = await User.find({
				homeLocationId: branch._id,
				staffRole: { $in: ["frontdesk", "trainer", "nutritionist"] },
				isActive: true,
			})
				.limit(5)
				.lean();

			for (const s of fallbackStaff) {
				staffMembers.push({
					id: s._id.toString(),
					name: s.username || "Branch Staff",
					role: s.staffRole || "frontdesk",
					isOnline: false,
				});
			}
		}

		// 4. Open Alerts
		const openAlerts = await OperationalAlert.find({
			branchId: branch._id,
			status: { $in: [AlertStatus.Open, AlertStatus.Acknowledged] },
		})
			.sort({ createdAt: -1 })
			.limit(10)
			.lean();

		const criticalCount = openAlerts.filter((a) => a.severity === "critical").length;
		const warningCount = openAlerts.filter((a) => a.severity === "warning").length;

		const recentAlerts: BranchBoardAlertItem[] = openAlerts.slice(0, 5).map((a) => ({
			id: a._id.toString(),
			type: a.type,
			severity: a.severity,
			status: a.status,
			title: a.title,
			message: a.message,
			createdAt: a.createdAt?.toISOString() || new Date().toISOString(),
		}));

		// 5. Today's Revenue (paid invoices)
		const paidInvoices = await Invoice.find({
			locationId: branch._id,
			paymentStatus: "PAID",
			createdAt: { $gte: startOfDay, $lte: endOfDay },
		})
			.select("total")
			.lean();

		const todayRevenue = paidInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
		const currency = branch.settings?.currency || "INR";

		boardItems.push({
			branch: {
				id: branchIdStr,
				name: branch.name,
				code: branch.code,
				timezone: tz,
				isActive: branch.isActive,
				phone: branch.phone,
			},
			sessions: {
				liveCount,
				upcomingCount,
				totalToday: sessionItems.length,
				items: sessionItems,
			},
			checkIns: {
				todayCount: todayCheckIns,
				currentlyInGym: activeCheckIns,
			},
			staffOnDuty: {
				count: staffMembers.length,
				members: staffMembers,
			},
			alerts: {
				openCount: openAlerts.length,
				criticalCount,
				warningCount,
				recentAlerts,
			},
			revenue: {
				todayTotal: todayRevenue,
				currency,
				invoiceCount: paidInvoices.length,
			},
		});
	}

	return {
		asOf: now.toISOString(),
		branches: boardItems,
	};
}
