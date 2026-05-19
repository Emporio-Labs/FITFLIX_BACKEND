import type { RequestHandler } from "express";
import mongoose from "mongoose";

export type NutritionServiceErrorCode =
	| "NOT_FOUND"
	| "FORBIDDEN"
	| "CONFLICT"
	| "VALIDATION"
	| "BAD_REQUEST";

export class NutritionServiceError extends Error {
	public readonly code: NutritionServiceErrorCode;

	constructor(code: NutritionServiceErrorCode, message: string) {
		super(message);
		this.name = "NutritionServiceError";
		this.code = code;
	}
}

export const toObjectId = (
	value: string,
	code: NutritionServiceErrorCode,
	message: string,
): mongoose.Types.ObjectId => {
	if (!mongoose.Types.ObjectId.isValid(value)) {
		throw new NutritionServiceError(code, message);
	}

	return new mongoose.Types.ObjectId(value);
};

// Express 5 types path params as `string | string[] | undefined`. Validate
// and narrow to a single ObjectId string or throw a 404.
export const requireIdParam = (
	value: string | string[] | undefined,
	message: string,
): string => {
	if (
		typeof value !== "string" ||
		!mongoose.Types.ObjectId.isValid(value)
	) {
		throw new NutritionServiceError("NOT_FOUND", message);
	}
	return value;
};

const STATUS_MAP: Record<NutritionServiceErrorCode, number> = {
	NOT_FOUND: 404,
	FORBIDDEN: 403,
	CONFLICT: 409,
	VALIDATION: 400,
	BAD_REQUEST: 400,
};

const CODE_MAP: Record<NutritionServiceErrorCode, string> = {
	NOT_FOUND: "NOT_FOUND",
	FORBIDDEN: "FORBIDDEN",
	CONFLICT: "CONFLICT",
	VALIDATION: "VALIDATION_ERROR",
	BAD_REQUEST: "BAD_REQUEST",
};

export const handleNutritionError = (
	error: unknown,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (error instanceof NutritionServiceError) {
		res.status(STATUS_MAP[error.code] ?? 400).json({
			error: error.message,
			code: CODE_MAP[error.code] ?? "BAD_REQUEST",
		});
		return;
	}

	next(error);
};

export const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
) => {
	const details: Record<string, string> = {};

	for (const issue of issues) {
		const field =
			issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}

	return details;
};

// All time-series nutrition docs are keyed by a UTC-midnight date. This is
// the single normalization point — never store a raw Date on those docs.
export const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);
