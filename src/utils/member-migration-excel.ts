import XLSX from "xlsx";
import type mongoose from "mongoose";
import {
	CreditTransactionSource,
	CreditTransactionType,
	Gender,
	MembershipStatus,
	OnboardingStep,
} from "../models/Enums";

export interface ParsedMemberRow {
	rowNumber: number;
	phone: string;
	name: string;
	email?: string;
	gender?: string;
	age?: number;
	planName: string;
	category?: string;
	startDate: Date;
	endDate?: Date;
	totalCredits: number;
	price?: number;
	notes?: string;
}

export interface ParsedSessionRow {
	rowNumber: number;
	phone: string;
	serviceName: string;
	serviceType: string;
	sessionDate: Date;
	creditsDeducted: number;
	notes?: string;
}

export interface MemberMigrationPreviewItem {
	phone: string;
	name: string;
	email?: string;
	gender: string;
	age: number;
	planName: string;
	category: string;
	startDate: string;
	endDate?: string;
	totalCredits: number;
	creditsUsed: number;
	creditsRemaining: number;
	price: number;
	notes?: string;
	sessions: Array<{
		serviceName: string;
		serviceType: string;
		sessionDate: string;
		creditsDeducted: number;
		notes?: string;
	}>;
	userExists: boolean;
	existingUserId?: string;
}

export interface MigrationValidationResult {
	valid: boolean;
	summary: {
		totalMembers: number;
		totalSessions: number;
		totalCreditsIncluded: number;
		totalCreditsDeducted: number;
		netRemainingCredits: number;
		existingUsersCount: number;
		newUsersCount: number;
	};
	members: MemberMigrationPreviewItem[];
	errors: Array<{ sheet: string; row: number; field?: string; message: string }>;
	warnings: Array<{ sheet: string; row?: number; message: string }>;
}

export interface MigrationExecutionResult {
	success: boolean;
	summary: {
		importedMembers: number;
		createdUsers: number;
		linkedUsers: number;
		totalSessionsRecorded: number;
		totalCreditsGranted: number;
		totalCreditsDeducted: number;
	};
	createdMemberships: Array<{
		membershipId: string;
		userId: string;
		phone: string;
		planName: string;
		creditsRemaining: number;
	}>;
	errors: string[];
}

/**
 * Normalizes phone numbers by stripping whitespace and non-alphanumeric chars (keeps leading + if any)
 */
export const normalizePhone = (phoneRaw: unknown): string => {
	if (!phoneRaw) return "";
	const str = String(phoneRaw).trim();
	// Remove common spaces, hyphens, brackets
	return str.replace(/[\s\-()]/g, "");
};

/**
 * Parses date cell into JS Date safely
 */
export const parseExcelDate = (val: unknown): Date | null => {
	if (!val) return null;
	if (val instanceof Date && !Number.isNaN(val.getTime())) {
		return val;
	}
	if (typeof val === "number") {
		// Excel date serial number (days since 1899-12-30)
		const parsed = XLSX.SSF.parse_date_code(val);
		if (parsed) {
			return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0));
		}
	}
	if (typeof val === "string") {
		const parsed = new Date(val.trim());
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}
	return null;
};

/**
 * Generate a 2-sheet Excel migration workbook buffer
 */
export function generateMigrationTemplateBuffer(): Buffer {
	const wb = XLSX.utils.book_new();

	// Sheet 1: Memberships
	const membershipHeaders = [
		"Phone",
		"Name",
		"Email",
		"Gender",
		"Age",
		"PlanName",
		"Category",
		"StartDate",
		"EndDate",
		"TotalCredits",
		"Price",
		"Notes",
	];

	const membershipSampleRows = [
		[
			"9876543210",
			"John Doe",
			"john.doe@example.com",
			"Male",
			28,
			"3-Month Elite",
			"GENERAL_MEMBERSHIP",
			"2026-08-01",
			"2026-11-01",
			50,
			15000,
			"Annual membership",
		],
		[
			"9123456780",
			"Sarah Smith",
			"sarah.smith@example.com",
			"Female",
			26,
			"Yoga 20 Pack",
			"GENERAL_MEMBERSHIP",
			"2026-09-01",
			"2026-12-01",
			20,
			6000,
			"Studio package",
		],
	];

	const wsMemberships = XLSX.utils.aoa_to_sheet([membershipHeaders, ...membershipSampleRows]);
	wsMemberships["!cols"] = [
		{ wch: 15 }, // Phone
		{ wch: 18 }, // Name
		{ wch: 25 }, // Email
		{ wch: 10 }, // Gender
		{ wch: 8 },  // Age
		{ wch: 20 }, // PlanName
		{ wch: 22 }, // Category
		{ wch: 14 }, // StartDate
		{ wch: 14 }, // EndDate
		{ wch: 14 }, // TotalCredits
		{ wch: 12 }, // Price
		{ wch: 30 }, // Notes
	];

	// Sheet 2: Past_Sessions
	const sessionHeaders = [
		"Phone",
		"ServiceName",
		"ServiceType",
		"SessionDate",
		"CreditsDeducted",
		"Notes",
	];

	const sessionSampleRows = [
		["9876543210", "Cryotherapy", "Therapy", "2026-08-10", 5, "Attended morning therapy session"],
		["9876543210", "Ice Bath", "Therapy", "2026-08-18", 5, "Recovery session"],
		["9876543210", "Hatha Yoga", "Service", "2026-08-25", 2, "Group studio class"],
		["9123456780", "Vinyasa Yoga", "Service", "2026-09-05", 2, "Studio session"],
		["9123456780", "Power Yoga", "Service", "2026-09-12", 2, "Studio session"],
	];

	const wsSessions = XLSX.utils.aoa_to_sheet([sessionHeaders, ...sessionSampleRows]);
	wsSessions["!cols"] = [
		{ wch: 15 }, // Phone
		{ wch: 20 }, // ServiceName
		{ wch: 14 }, // ServiceType
		{ wch: 14 }, // SessionDate
		{ wch: 16 }, // CreditsDeducted
		{ wch: 30 }, // Notes
	];

	XLSX.utils.book_append_sheet(wb, wsMemberships, "Memberships");
	XLSX.utils.book_append_sheet(wb, wsSessions, "Past_Sessions");

	return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Finds sheet by fuzzy name
 */
function findSheet(wb: XLSX.WorkBook, candidates: string[]): XLSX.WorkSheet | null {
	for (const name of wb.SheetNames) {
		const normalized = name.trim().toLowerCase().replace(/[\s_-]/g, "");
		for (const cand of candidates) {
			if (normalized === cand.trim().toLowerCase().replace(/[\s_-]/g, "")) {
				return wb.Sheets[name] ?? null;
			}
		}
	}
	return null;
}

/**
 * Normalize row object keys from header
 */
function normalizeRowKeys(rawRow: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(rawRow)) {
		const cleanKey = key.trim().toLowerCase().replace(/[\s_-]/g, "");
		result[cleanKey] = val;
	}
	return result;
}

/**
 * Parse and validate both sheets
 */
export async function parseAndValidateMigrationWorkbook(
	buffer: Buffer,
	options?: {
		userLookup?: (phones: string[]) => Promise<Array<{ phone: string; _id: string; username: string }>>;
	},
): Promise<MigrationValidationResult> {
	let wb: XLSX.WorkBook;
	try {
		wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
	} catch (err) {
		return {
			valid: false,
			summary: {
				totalMembers: 0,
				totalSessions: 0,
				totalCreditsIncluded: 0,
				totalCreditsDeducted: 0,
				netRemainingCredits: 0,
				existingUsersCount: 0,
				newUsersCount: 0,
			},
			members: [],
			errors: [{ sheet: "Workbook", row: 0, message: "Could not parse Excel workbook file (.xlsx)." }],
			warnings: [],
		};
	}

	const wsMemberships = findSheet(wb, ["memberships", "members", "membership"]);
	const wsSessions = findSheet(wb, ["pastsessions", "sessions", "pastsession", "usage"]);

	const errors: Array<{ sheet: string; row: number; field?: string; message: string }> = [];
	const warnings: Array<{ sheet: string; row?: number; message: string }> = [];

	if (!wsMemberships) {
		errors.push({
			sheet: "Workbook",
			row: 0,
			message: "Missing 'Memberships' sheet. Please use the migration template.",
		});
		return {
			valid: false,
			summary: {
				totalMembers: 0,
				totalSessions: 0,
				totalCreditsIncluded: 0,
				totalCreditsDeducted: 0,
				netRemainingCredits: 0,
				existingUsersCount: 0,
				newUsersCount: 0,
			},
			members: [],
			errors,
			warnings,
		};
	}

	// 1. Parse Memberships rows
	const rawMemberRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsMemberships, { defval: "" });
	const memberMap = new Map<string, ParsedMemberRow>();

	rawMemberRows.forEach((raw, idx) => {
		const rowNum = idx + 2; // header is row 1
		const r = normalizeRowKeys(raw);

		const phone = normalizePhone(r.phone || r.phonenumber || r.mobile || r.contact);
		const name = String(r.name || r.fullname || r.membername || r.username || "").trim();
		const planName = String(r.planname || r.plan || r.membership || "").trim();
		const email = r.email ? String(r.email).trim() : undefined;
		const genderRaw = String(r.gender || "").trim().toLowerCase();
		const gender = genderRaw === "male" ? Gender.Male : genderRaw === "female" ? Gender.Female : Gender.Other;
		const ageNum = Number(r.age);
		const age = Number.isFinite(ageNum) && ageNum > 0 ? ageNum : 25;
		const categoryRaw = String(r.category || "").trim().toUpperCase();
		const allowedCategories = ["PERSONAL_TRAINING", "GENERAL_MEMBERSHIP", "THERAPY_PACK", "CREDIT_PACK"];
		const category = allowedCategories.includes(categoryRaw) ? categoryRaw : "GENERAL_MEMBERSHIP";

		const startDate = parseExcelDate(r.startdate || r.start);
		const endDate = parseExcelDate(r.enddate || r.end);
		const totalCredits = Number(r.totalcredits || r.credits || r.creditsincluded || 0);
		const price = Number(r.price || r.amount || 0);
		const notes = r.notes ? String(r.notes).trim() : undefined;

		if (!phone) {
			errors.push({ sheet: "Memberships", row: rowNum, field: "Phone", message: "Phone number is required" });
			return;
		}

		if (!name) {
			errors.push({ sheet: "Memberships", row: rowNum, field: "Name", message: "Member name is required" });
			return;
		}

		if (!planName) {
			errors.push({ sheet: "Memberships", row: rowNum, field: "PlanName", message: "Plan name is required" });
			return;
		}

		if (!startDate) {
			errors.push({ sheet: "Memberships", row: rowNum, field: "StartDate", message: "Valid StartDate (YYYY-MM-DD) is required" });
			return;
		}

		if (!Number.isFinite(totalCredits) || totalCredits < 0) {
			errors.push({ sheet: "Memberships", row: rowNum, field: "TotalCredits", message: "TotalCredits must be a non-negative number" });
			return;
		}

		if (memberMap.has(phone)) {
			errors.push({ sheet: "Memberships", row: rowNum, field: "Phone", message: `Duplicate phone number '${phone}' in Memberships sheet` });
			return;
		}

		memberMap.set(phone, {
			rowNumber: rowNum,
			phone,
			name,
			email,
			gender,
			age,
			planName,
			category,
			startDate,
			endDate: endDate || undefined,
			totalCredits,
			price: Number.isFinite(price) && price >= 0 ? price : 0,
			notes,
		});
	});

	// 2. Parse Past_Sessions rows (if sheet exists)
	const sessionsByPhone = new Map<string, ParsedSessionRow[]>();
	if (wsSessions) {
		const rawSessionRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsSessions, { defval: "" });
		rawSessionRows.forEach((raw, idx) => {
			const rowNum = idx + 2;
			const r = normalizeRowKeys(raw);

			const phone = normalizePhone(r.phone || r.phonenumber || r.mobile || r.contact);
			const serviceName = String(r.servicename || r.service || r.therapy || r.therapyname || r.class || "").trim();
			const serviceTypeRaw = String(r.servicetype || r.type || "").trim().toLowerCase();
			const serviceType = serviceTypeRaw === "service" || serviceTypeRaw === "class" ? "Service" : "Therapy";
			const sessionDate = parseExcelDate(r.sessiondate || r.date);
			const creditsDeducted = Number(r.creditsdeducted || r.credits || r.creditscost || r.usedcredits || 0);
			const notes = r.notes ? String(r.notes).trim() : undefined;

			// Skip completely empty trailing rows
			if (!phone && !serviceName && !creditsDeducted) {
				return;
			}

			if (!phone) {
				errors.push({ sheet: "Past_Sessions", row: rowNum, field: "Phone", message: "Phone number is required" });
				return;
			}

			if (!serviceName) {
				errors.push({ sheet: "Past_Sessions", row: rowNum, field: "ServiceName", message: "ServiceName/Therapy is required" });
				return;
			}

			if (!Number.isFinite(creditsDeducted) || creditsDeducted <= 0) {
				errors.push({ sheet: "Past_Sessions", row: rowNum, field: "CreditsDeducted", message: "CreditsDeducted must be a positive number (>0)" });
				return;
			}

			if (!memberMap.has(phone)) {
				warnings.push({ sheet: "Past_Sessions", row: rowNum, message: `Session for phone '${phone}' does not match any member in Memberships sheet (will be ignored).` });
				return;
			}

			const list = sessionsByPhone.get(phone) || [];
			list.push({
				rowNumber: rowNum,
				phone,
				serviceName,
				serviceType,
				sessionDate: sessionDate || memberMap.get(phone)!.startDate,
				creditsDeducted,
				notes,
			});
			sessionsByPhone.set(phone, list);
		});
	} else {
		warnings.push({ sheet: "Past_Sessions", message: "No 'Past_Sessions' sheet found. Members will be created with their full TotalCredits remaining." });
	}

	// 3. Match against existing users in MongoDB
	const phones = Array.from(memberMap.keys());
	let existingUsers: Array<{ phone: string; _id: string; username: string }> = [];
	if (options?.userLookup) {
		existingUsers = await options.userLookup(phones);
	} else {
		try {
			const { default: User } = await import("../models/User");
			const found = await User.find({ phone: { $in: phones } }).select("_id phone username").lean();
			existingUsers = found.map((u) => ({ phone: u.phone, _id: u._id.toString(), username: u.username }));
		} catch {
			// In unit test environment without active DB connection
		}
	}

	const existingUserMap = new Map<string, { _id: string; username: string }>();
	for (const u of existingUsers) {
		existingUserMap.set(u.phone, { _id: u._id, username: u.username });
	}

	// 4. Build preview items and check mathematical integrity
	const members: MemberMigrationPreviewItem[] = [];
	let totalCreditsIncluded = 0;
	let totalCreditsDeducted = 0;
	let newUsersCount = 0;
	let existingUsersCount = 0;

	for (const [phone, m] of memberMap.entries()) {
		const sessions = sessionsByPhone.get(phone) || [];
		const creditsUsed = sessions.reduce((sum, s) => sum + s.creditsDeducted, 0);
		const creditsRemaining = m.totalCredits - creditsUsed;

		totalCreditsIncluded += m.totalCredits;
		totalCreditsDeducted += creditsUsed;

		if (creditsRemaining < 0) {
			errors.push({
				sheet: "Memberships",
				row: m.rowNumber,
				field: "TotalCredits",
				message: `Member ${phone} has total credits (${m.totalCredits}) less than past sessions used (${creditsUsed}). Remaining balance cannot be negative (${creditsRemaining}).`,
			});
		}

		const existing = existingUserMap.get(phone);
		if (existing) {
			existingUsersCount += 1;
		} else {
			newUsersCount += 1;
		}

		members.push({
			phone,
			name: m.name,
			email: m.email,
			gender: m.gender || Gender.Other,
			age: m.age || 25,
			planName: m.planName,
			category: m.category || "GENERAL_MEMBERSHIP",
			startDate: m.startDate.toISOString().slice(0, 10),
			endDate: m.endDate ? m.endDate.toISOString().slice(0, 10) : undefined,
			totalCredits: m.totalCredits,
			creditsUsed,
			creditsRemaining: Math.max(0, creditsRemaining),
			price: m.price || 0,
			notes: m.notes,
			sessions: sessions.map((s) => ({
				serviceName: s.serviceName,
				serviceType: s.serviceType,
				sessionDate: s.sessionDate.toISOString().slice(0, 10),
				creditsDeducted: s.creditsDeducted,
				notes: s.notes,
			})),
			userExists: Boolean(existing),
			existingUserId: existing?._id,
		});
	}

	return {
		valid: errors.length === 0,
		summary: {
			totalMembers: members.length,
			totalSessions: Array.from(sessionsByPhone.values()).reduce((sum, list) => sum + list.length, 0),
			totalCreditsIncluded,
			totalCreditsDeducted,
			netRemainingCredits: Math.max(0, totalCreditsIncluded - totalCreditsDeducted),
			existingUsersCount,
			newUsersCount,
		},
		members,
		errors,
		warnings,
	};
}

/**
 * Execute the migration in the database
 */
export async function executeMigrationBatch(
	validatedData: MigrationValidationResult,
	actorId?: string,
	actorRole?: string,
): Promise<MigrationExecutionResult> {
	if (!validatedData.valid || validatedData.members.length === 0) {
		throw new Error("Cannot execute invalid migration data. Please resolve validation errors first.");
	}

	const { default: mongoose } = await import("mongoose");
	const { default: User } = await import("../models/User");
	const { default: Membership } = await import("../models/Membership");
	const { default: Service } = await import("../models/Service");
	const { default: CreditTransaction } = await import("../models/CreditTransaction");

	const createdMemberships: Array<{
		membershipId: string;
		userId: string;
		phone: string;
		planName: string;
		creditsRemaining: number;
	}> = [];

	let createdUsers = 0;
	let linkedUsers = 0;
	let totalSessionsRecorded = 0;
	let totalCreditsGranted = 0;
	let totalCreditsDeducted = 0;
	const executionErrors: string[] = [];

	// Pre-fetch services to link sourceId if matching
	const allServices = await Service.find({}).select("_id serviceName serviceType").lean();
	const serviceNameMap = new Map<string, { _id: mongoose.Types.ObjectId; serviceType: string }>();
	for (const s of allServices) {
		serviceNameMap.set(s.serviceName.trim().toLowerCase(), {
			_id: s._id as mongoose.Types.ObjectId,
			serviceType: s.serviceType,
		});
	}

	for (const m of validatedData.members) {
		try {
			// 1. Get or create user
			let userId: mongoose.Types.ObjectId;
			const existingUserDoc = await User.findOne({ phone: m.phone });

			if (!existingUserDoc) {
				const newUser = await User.create({
					username: m.name,
					phone: m.phone,
					email: m.email || undefined,
					gender: m.gender as Gender,
					age: m.age || 25,
					onboarded: true,
					onboardingStatus: {
						onboardingCompleted: true,
						healthMarkersCompleted: true,
						healthGoalsCompleted: true,
						consentCompleted: true,
						reportsUploaded: true,
						nutritionistBooked: true,
						completedSteps: [OnboardingStep.COMPLETED],
						completedAt: new Date(),
					},
				});
				userId = newUser._id as mongoose.Types.ObjectId;
				createdUsers += 1;
			} else {
				userId = existingUserDoc._id as mongoose.Types.ObjectId;
				linkedUsers += 1;
			}

			// 2. Create Membership
			const startDate = new Date(m.startDate);
			const endDate = m.endDate ? new Date(m.endDate) : undefined;

			const membership = await Membership.create({
				user: userId,
				planName: m.planName,
				category: m.category as "PERSONAL_TRAINING" | "GENERAL_MEMBERSHIP" | "THERAPY_PACK" | "CREDIT_PACK",
				creditsIncluded: m.totalCredits,
				creditsRemaining: m.creditsRemaining,
				source: "MIGRATION",
				status: MembershipStatus.Active,
				price: m.price || 0,
				currency: "INR",
				startDate,
				...(endDate ? { endDate } : {}),
				notes: m.notes || "Imported via Excel migration",
			});

			totalCreditsGranted += m.totalCredits;

			const safeActorRole = (actorRole as "admin" | "user" | "doctor" | "trainer" | "nutritionist" | "frontdesk" | "system") || "admin";

			// 3. Insert Initial Grant CreditTransaction
			await CreditTransaction.create({
				user: userId,
				membership: membership._id,
				amount: m.totalCredits,
				type: CreditTransactionType.AdminTopUp,
				sourceType: CreditTransactionSource.Admin,
				sourceId: membership._id,
				reason: `Membership Activated: ${m.planName}`,
				actorId: actorId ? new mongoose.Types.ObjectId(actorId) : undefined,
				actorRole: safeActorRole,
				createdAt: startDate,
			});

			// 4. Insert Past Sessions CreditTransactions as normal bookings
			for (const session of m.sessions) {
				const sessionDate = new Date(session.sessionDate);
				const matchedService = serviceNameMap.get(session.serviceName.trim().toLowerCase());

				const sessionReason = session.notes && session.notes.trim().length > 0
					? `${session.serviceName} - ${session.notes}`
					: `Booking: ${session.serviceName}`;

				await CreditTransaction.create({
					user: userId,
					membership: membership._id,
					amount: -session.creditsDeducted,
					type: CreditTransactionType.Consume,
					sourceType: CreditTransactionSource.Booking,
					sourceId: matchedService ? matchedService._id : undefined,
					reason: sessionReason,
					actorId: actorId ? new mongoose.Types.ObjectId(actorId) : undefined,
					actorRole: safeActorRole,
					metadata: {
						serviceName: session.serviceName,
						serviceType: session.serviceType,
						sessionDate: session.sessionDate,
					},
					createdAt: sessionDate,
				});

				totalSessionsRecorded += 1;
				totalCreditsDeducted += session.creditsDeducted;
			}

			createdMemberships.push({
				membershipId: membership._id.toString(),
				userId: userId.toString(),
				phone: m.phone,
				planName: m.planName,
				creditsRemaining: m.creditsRemaining,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			executionErrors.push(`Failed to migrate member ${m.phone} (${m.name}): ${msg}`);
		}
	}

	return {
		success: executionErrors.length === 0,
		summary: {
			importedMembers: createdMemberships.length,
			createdUsers,
			linkedUsers,
			totalSessionsRecorded,
			totalCreditsGranted,
			totalCreditsDeducted,
		},
		createdMemberships,
		errors: executionErrors,
	};
}
