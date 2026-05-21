import * as jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { CreditServiceError } from "./credit.service";

export type ApiErrorCode =
	| "VALIDATION_ERROR"
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "CONFLICT"
	| "NOT_IMPLEMENTED"
	| "INTERNAL_ERROR"
	| "API_ERROR";

export type ApiErrorEnvelope = {
	error: string;
	code: ApiErrorCode | string;
	details?: unknown;
};

type DebugDetails = {
	name: string;
	message: string;
	stack?: string;
};

type NormalizedError = {
	status: number;
	error: string;
	code?: string;
	details?: unknown;
};

type NormalizeErrorResponseInput = {
	status: number;
	body: unknown;
	verbose?: boolean;
	error?: unknown;
};

type ResolvedErrorResponse = {
	status: number;
	body: ApiErrorEnvelope;
};

const RESPONSE_ERROR_NAME = "ResponseError";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

const parseBooleanEnv = (value: string | undefined): boolean | null => {
	if (value === undefined) {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}

	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}

	return null;
};

export const isErrorVerboseEnabled = (): boolean => {
	const override = parseBooleanEnv(process.env.ERROR_VERBOSE);
	if (override !== null) {
		return override;
	}

	return process.env.NODE_ENV !== "production";
};

const normalizeIssueDetails = (
	issues: Array<{ path?: unknown; message?: unknown }>,
): Record<string, string> => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		if (!issue || typeof issue !== "object") {
			continue;
		}

		const field =
			Array.isArray(issue.path) && issue.path.length > 0
				? issue.path.map(String).join(".")
				: "body";

		if (!details[field] && typeof issue.message === "string") {
			details[field] = issue.message;
		}
	}

	return details;
};

const normalizeDetails = (value: unknown): unknown => {
	if (!Array.isArray(value)) {
		return value;
	}

	const details = normalizeIssueDetails(value);
	return Object.keys(details).length > 0 ? details : value;
};

const buildDebugDetails = (error: Error, fallbackMessage: string): DebugDetails => ({
	name: error.name || RESPONSE_ERROR_NAME,
	message: error.message || fallbackMessage,
	stack: error.stack,
});

const mergeDebugDetails = (
	details: unknown,
	debug: DebugDetails,
): unknown => {
	if (!details) {
		return { debug };
	}

	if (Array.isArray(details)) {
		return { data: details, debug };
	}

	if (!isPlainObject(details)) {
		return { value: details, debug };
	}

	if ("debug" in details) {
		return details;
	}

	return { ...details, debug };
};

const ensureDebugSource = (source: unknown, message: string): Error => {
	if (source instanceof Error) {
		return source;
	}

	if (isPlainObject(source)) {
		const name = typeof source.name === "string" ? source.name : undefined;
		const stack = typeof source.stack === "string" ? source.stack : undefined;
		const errMessage =
			typeof source.message === "string" ? source.message : message;

		if (name || stack) {
			const error = new Error(errMessage);
			error.name = name ?? RESPONSE_ERROR_NAME;
			if (stack) {
				error.stack = stack;
			}
			return error;
		}
	}

	const fallback = new Error(message);
	fallback.name = RESPONSE_ERROR_NAME;
	return fallback;
};

const hasValidationDetails = (details: unknown): boolean => {
	if (Array.isArray(details)) {
		return details.length > 0;
	}

	if (!details || typeof details !== "object") {
		return false;
	}

	return Object.keys(details).length > 0;
};

export const mapStatusToErrorCode = (
	status: number,
	overrideCode?: string,
	details?: unknown,
): ApiErrorCode | string => {
	if (overrideCode) {
		return overrideCode;
	}

	if (status === 400) {
		return hasValidationDetails(details) ? "VALIDATION_ERROR" : "BAD_REQUEST";
	}

	switch (status) {
		case 401:
			return "UNAUTHORIZED";
		case 403:
			return "FORBIDDEN";
		case 404:
			return "NOT_FOUND";
		case 409:
			return "CONFLICT";
		case 501:
			return "NOT_IMPLEMENTED";
		case 500:
			return "INTERNAL_ERROR";
		default:
			return "API_ERROR";
	}
};

export const buildApiErrorEnvelope = ({
	error,
	code,
	details,
}: ApiErrorEnvelope): ApiErrorEnvelope => {
	if (details === undefined) {
		return { error, code };
	}

	return { error, code, details };
};

export const isApiErrorEnvelope = (
	value: unknown,
): value is ApiErrorEnvelope => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.error === "string" && typeof candidate.code === "string"
	);
};

const resolveErrorStatus = (error: unknown): number | null => {
	if (!isPlainObject(error)) {
		return null;
	}

	const status =
		typeof error.status === "number"
			? error.status
			: typeof error.statusCode === "number"
				? error.statusCode
				: null;

	if (!status || status < 400 || status >= 600) {
		return null;
	}

	return status;
};

const resolveErrorMessage = (error: unknown): string | null => {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	if (isPlainObject(error) && typeof error.message === "string") {
		return error.message;
	}

	return null;
};

const resolveErrorDetails = (error: unknown): unknown => {
	if (!isPlainObject(error)) {
		return undefined;
	}

	return normalizeDetails(error.details);
};

const isJsonParseError = (error: unknown): boolean => {
	if (!(error instanceof SyntaxError)) {
		return false;
	}

	const candidate = error as { status?: number; type?: string };
	return candidate.status === 400 || candidate.type === "entity.parse.failed";
};

const isDuplicateKeyError = (
	error: unknown,
): { keyValue?: Record<string, unknown>; keyPattern?: Record<string, unknown> } | null => {
	if (!isPlainObject(error)) {
		return null;
	}

	if (error.code !== 11000) {
		return null;
	}

	const keyValue = isPlainObject(error.keyValue) ? error.keyValue : undefined;
	const keyPattern = isPlainObject(error.keyPattern)
		? error.keyPattern
		: undefined;

	return { keyValue, keyPattern };
};

const isJwtError = (error: unknown): boolean =>
	error instanceof jwt.JsonWebTokenError ||
	error instanceof jwt.TokenExpiredError ||
	error instanceof jwt.NotBeforeError;

const mapCreditServiceError = (
	error: CreditServiceError,
): { status: number; message: string } => {
	switch (error.code) {
		case "NO_ACTIVE_MEMBERSHIP":
			return {
				status: 403,
				message: "No active membership with available credits",
			};
		case "INSUFFICIENT_CREDITS":
			return { status: 402, message: "Insufficient credits" };
		default:
			return { status: 400, message: error.message };
	}
};

const mapError = (error: unknown, fallbackMessage?: string): NormalizedError => {
	if (error instanceof ZodError) {
		const details = normalizeIssueDetails(error.issues);
		return {
			status: 400,
			error: "Validation failed",
			details,
		};
	}

	if (error instanceof mongoose.Error.ValidationError) {
		const details: Record<string, string> = {};
		for (const [key, entry] of Object.entries(error.errors)) {
			if (details[key]) {
				continue;
			}
			const message =
				entry && typeof entry.message === "string"
					? entry.message
					: "Validation failed";
			details[key] = message;
		}
		return {
			status: 400,
			error: "Validation failed",
			details,
		};
	}

	if (error instanceof mongoose.Error.CastError) {
		return {
			status: 400,
			error: "Invalid request parameter",
			details: {
				[error.path || "field"]: error.message || "Invalid value",
			},
		};
	}

	const duplicate = isDuplicateKeyError(error);
	if (duplicate) {
		return {
			status: 409,
			error: "Duplicate value",
			details: duplicate.keyValue
				? { keys: duplicate.keyValue }
				: duplicate.keyPattern
					? { keys: duplicate.keyPattern }
					: undefined,
		};
	}

	if (error instanceof CreditServiceError) {
		const mapped = mapCreditServiceError(error);
		return { status: mapped.status, error: mapped.message };
	}

	if (isJwtError(error)) {
		return { status: 401, error: "Invalid or expired token" };
	}

	if (isJsonParseError(error)) {
		return { status: 400, error: "Invalid JSON payload" };
	}

	const status = resolveErrorStatus(error) ?? 500;
	const messageFromError = resolveErrorMessage(error);
	const details = status < 500 ? resolveErrorDetails(error) : undefined;
	const baseMessage =
		fallbackMessage ??
		(status >= 500 ? "Internal server error" : "Request failed");
	return {
		status,
		error:
			status < 500 && messageFromError ? messageFromError : baseMessage,
		details,
	};
};

const attachDebugDetails = (
	envelope: ApiErrorEnvelope,
	error: unknown,
	verbose?: boolean,
): ApiErrorEnvelope => {
	if (!verbose) {
		return envelope;
	}

	const debugSource = ensureDebugSource(error, envelope.error);
	const debug = buildDebugDetails(debugSource, envelope.error);
	const details = mergeDebugDetails(envelope.details, debug);

	return buildApiErrorEnvelope({
		error: envelope.error,
		code: envelope.code,
		details,
	});
};

export const normalizeErrorResponse = (
	input: NormalizeErrorResponseInput,
): ApiErrorEnvelope => {
	if (isApiErrorEnvelope(input.body)) {
		const normalizedDetails = normalizeDetails(input.body.details);
		const envelope =
			normalizedDetails === input.body.details
				? input.body
				: { ...input.body, details: normalizedDetails };
		return attachDebugDetails(envelope, input.error ?? input.body, input.verbose);
	}

	if (input.body instanceof Error) {
		const details = normalizeDetails(
			isPlainObject(input.body) ? input.body.details : undefined,
		);
		const envelope = buildApiErrorEnvelope({
			error: input.body.message || "Request failed",
			code: mapStatusToErrorCode(input.status, undefined, details),
			details,
		});
		return attachDebugDetails(envelope, input.body, input.verbose);
	}

	if (isPlainObject(input.body)) {
		const details = normalizeDetails(
			input.body.details ?? input.body.errors,
		);
		const message =
			typeof input.body.error === "string"
				? input.body.error
				: typeof input.body.message === "string"
					? input.body.message
					: "Request failed";
		const code = mapStatusToErrorCode(
			input.status,
			typeof input.body.code === "string" ? input.body.code : undefined,
			details,
		);
		const envelope = buildApiErrorEnvelope({
			error: message,
			code,
			details,
		});
		return attachDebugDetails(envelope, input.error ?? input.body, input.verbose);
	}

	const message =
		typeof input.body === "string" ? input.body : "Request failed";
	const envelope = buildApiErrorEnvelope({
		error: message,
		code: mapStatusToErrorCode(input.status),
	});
	return attachDebugDetails(envelope, input.error ?? input.body, input.verbose);
};

export const resolveErrorResponse = (
	error: unknown,
	options?: { verbose?: boolean; fallbackMessage?: string },
): ResolvedErrorResponse => {
	const normalized = mapError(error, options?.fallbackMessage);
	const envelope = buildApiErrorEnvelope({
		error: normalized.error,
		code: mapStatusToErrorCode(
			normalized.status,
			normalized.code,
			normalized.details,
		),
		details: normalized.details,
	});

	return {
		status: normalized.status,
		body: attachDebugDetails(envelope, error, options?.verbose),
	};
};
