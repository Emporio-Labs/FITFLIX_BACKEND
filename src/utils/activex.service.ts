import dotenv from "dotenv";
import mongoose from "mongoose";
import BcaMetric from "../models/BcaMetric";
import { OnboardingStep } from "../models/Enums";
import { updateSharedOnboardingStep } from "./onboarding.service";

dotenv.config();

const ACTIVEX_BASE_URL =
	process.env.ACTIVEX_BASE_URL ?? "https://api.activex.ai/external/bca";
const ACTIVEX_API_KEY = process.env.ACTIVEX_API_KEY ?? "";
const ACTIVEX_LOOKBACK_DAYS = Number(
	process.env.ACTIVEX_BCA_LOOKBACK_DAYS ?? 365,
);

export class ActiveXError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "NOT_CONFIGURED"
			| "UNAUTHORIZED"
			| "BAD_REQUEST"
			| "UPSTREAM_ERROR",
		public readonly status = 502,
	) {
		super(message);
		this.name = "ActiveXError";
	}
}

/**
 * Normalise a stored phone number into the ActiveX format `+91-XXXXXXXXXX`.
 * Accepts variants like `+91XXXXXXXXXX`, `91XXXXXXXXXX`, `XXXXXXXXXX`.
 */
export const formatPhoneForActiveX = (phone: string): string => {
	const digits = phone.replace(/\D/g, "");
	const last10 = digits.slice(-10);
	return `+91-${last10}`;
};

/** A single BCA record as returned inside `result.records[]` by ActiveX. */
export type ActiveXRecord = Record<string, unknown>;

/**
 * Fetch BCA records for a phone number captured on/after `sinceDate`.
 * Returns the raw `result.records` array (empty if the number has no scans).
 */
export const fetchBcaRecords = async (
	phone: string,
	sinceDate?: Date,
): Promise<ActiveXRecord[]> => {
	if (!ACTIVEX_API_KEY) {
		throw new ActiveXError(
			"ActiveX API key is not configured (ACTIVEX_API_KEY).",
			"NOT_CONFIGURED",
			500,
		);
	}

	const date =
		sinceDate ??
		new Date(Date.now() - ACTIVEX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

	let response: Response;
	try {
		response = await fetch(ACTIVEX_BASE_URL, {
			method: "POST",
			headers: {
				"x-api-key": ACTIVEX_API_KEY,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				Date: date.toISOString(),
				PhoneNumbers: [formatPhoneForActiveX(phone)],
			}),
		});
	} catch (err) {
		throw new ActiveXError(
			`Failed to reach ActiveX API: ${(err as Error).message}`,
			"UPSTREAM_ERROR",
		);
	}

	if (response.status === 401) {
		throw new ActiveXError(
			"ActiveX rejected the API key (401).",
			"UNAUTHORIZED",
			502,
		);
	}
	if (response.status === 400) {
		throw new ActiveXError(
			"ActiveX rejected the request (400).",
			"BAD_REQUEST",
			502,
		);
	}

	let payload: {
		result?: { records?: ActiveXRecord[] };
		success?: boolean;
		error?: { code?: number; message?: string; details?: unknown };
		unAuthorizedRequest?: boolean;
	} = {};

	try {
		payload = (await response.json()) as typeof payload;
	} catch (_) {
		if (!response.ok) {
			throw new ActiveXError(
				`ActiveX API returned ${response.status}.`,
				"UPSTREAM_ERROR",
			);
		}
	}

	if (response.status === 404 || payload.error?.message?.toLowerCase().includes("no user found")) {
		// Normal: phone number has no scans on record in ActiveX database
		return [];
	}

	if (!response.ok) {
		throw new ActiveXError(
			`ActiveX API returned ${response.status}.`,
			"UPSTREAM_ERROR",
		);
	}

	if (payload.success === false) {
		throw new ActiveXError(
			`ActiveX API reported failure: ${JSON.stringify(payload.error)}`,
			"UPSTREAM_ERROR",
		);
	}

	return payload.result?.records ?? [];
};

const num = (val: unknown): number | null => {
	if (val === null || val === undefined) return null;
	const n = typeof val === "number" ? val : Number(val);
	return Number.isFinite(n) ? n : null;
};

/**
 * Map a raw ActiveX BCA record into a `bca_metrics` document payload.
 */
export const mapActiveXRecordToBcaMetric = (
	record: ActiveXRecord,
	userId: mongoose.Types.ObjectId,
	receivedAt: Date = new Date(),
) => {
	const r = record as Record<string, any>;
	const insertion = r.insertionDate ? new Date(r.insertionDate) : null;
	const recordedAt =
		insertion && !Number.isNaN(insertion.getTime()) ? insertion : receivedAt;
	const age = num(r.ppAge);

	return {
		userId,
		recordedAt,
		receivedAt,
		patientPhone: typeof r.phone === "string" ? r.phone : null,
		age: age !== null ? String(age) : null,
		gender: typeof r.ppSex === "string" ? r.ppSex : null,
		vitals: {
			weight_kg: num(r.ppWeightKg),
			height_cm: num(r.ppHeightCm),
			bmi: num(r.ppBMI),
			pulse: num(r.ppHeartRate),
			heart_rate: num(r.ppHeartRate),
		},
		bodyComposition: {
			body_fat_mass_kg: num(r.ppBodyfatKg),
			body_fat_percent: num(r.ppFat),
			skeletal_muscle_mass_kg: num(r.ppBodySkeletalKg),
			muscle_mass_kg: num(r.ppMuscleKg),
			total_body_water_L: num(r.ppWaterKg),
			protein_kg: num(r.ppProteinKg),
			minerals_kg: num(r.ppMineralKg),
			visceral_fat: num(r.ppVisceralFat),
			basal_metabolic_rate_cal: num(r.ppBMR),
			body_age: num(r.ppBodyAge),
		},
		idealBodyWeight_kg: num(r.ppIdealWeightKg),
		weightToLose_kg: num(r.ppControlWeightKg),
		source: "activex",
	};
};

/**
 * Persist one BCA record for a resolved member and mark the shared
 * onboarding "Active X test" step complete. Shared by both ingest paths:
 * the member-initiated pull (`POST /users/me/bca-metrics/sync`) and the
 * vendor-initiated push (`POST /internal/bca/ingest`) — one upsert path so
 * `activeXTestCompleted` can never disagree with what's actually on file in
 * `bca_metrics`.
 *
 * A failure ticking the onboarding flag is logged but does not roll back the
 * metric write — the scan is the primary artifact; the flag is a derived
 * convenience the front desk reads at check-in.
 */
export const upsertBcaRecordForUser = async (
	userId: mongoose.Types.ObjectId,
	record: ActiveXRecord,
	receivedAt: Date = new Date(),
) => {
	const payload = mapActiveXRecordToBcaMetric(record, userId, receivedAt);

	await BcaMetric.updateOne(
		{ userId, recordedAt: payload.recordedAt },
		{ $set: payload },
		{ upsert: true },
	);

	try {
		await updateSharedOnboardingStep(
			userId.toString(),
			OnboardingStep.ACTIVE_X_TEST,
			true,
		);
	} catch (err) {
		console.error(
			`[activex] Scan saved for user ${userId.toString()} but failed to mark ACTIVE_X_TEST complete:`,
			err,
		);
	}

	return payload;
};
