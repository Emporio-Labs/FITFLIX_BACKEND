import type { JwtPayload, SignOptions, VerifyOptions } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import type { AppUserRole, AuthenticatedUser } from "../types/auth";

export type JwtConfig = {
	secret: string;
	issuer?: string;
	audience?: string;
	expiresIn: string;
};

// Default session lifetime: 8 months (~240 days). A device that logs in stays
// authenticated for the full window without a surprise logout; the session ends
// only on manual logout (token blacklist), token expiry, or app-data clear.
const DEFAULT_EXPIRES_IN = "240d";

const parseExpiresIn = (value: string | undefined): string => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : DEFAULT_EXPIRES_IN;
};

const normalizeOptional = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const isAppUserRole = (value: unknown): value is AppUserRole =>
	value === "user" ||
	value === "admin" ||
	value === "doctor" ||
	value === "trainer" ||
	value === "nutritionist" ||
	value === "frontdesk" ||
	value === "staff" ||
	value === "ROLE_FRONT_DESK_STAFF" ||
	value === "ROLE_FRONT_END_STAFF" ||
	value === "ROLE_MEMBER";

export const getJwtConfig = (): JwtConfig | null => {
	const secret = process.env.JWT_SECRET?.trim();
	if (!secret) {
		return null;
	}

	return {
		secret,
		issuer: normalizeOptional(process.env.JWT_ISSUER),
		audience: normalizeOptional(process.env.JWT_AUDIENCE),
		expiresIn: parseExpiresIn(process.env.JWT_EXPIRES_IN),
	};
};

export const getJwtRefreshConfig = (): JwtConfig | null => {
	// Fall back to JWT_SECRET when a dedicated refresh secret isn't configured.
	// This guarantees a refresh token is ALWAYS issued at login — a missing
	// JWT_REFRESH_SECRET used to silently drop the refresh token, collapsing the
	// session down to the access-token lifetime and forcing premature logouts.
	const secret =
		process.env.JWT_REFRESH_SECRET?.trim() || process.env.JWT_SECRET?.trim();
	if (!secret) {
		return null;
	}

	return {
		secret,
		issuer: normalizeOptional(process.env.JWT_ISSUER),
		audience: normalizeOptional(process.env.JWT_AUDIENCE),
		expiresIn: parseExpiresIn(process.env.JWT_REFRESH_EXPIRES_IN),
	};
};

const buildSignOptions = (config: JwtConfig): SignOptions => {
	const options: SignOptions = {
		expiresIn: config.expiresIn as unknown as number,
	};

	if (config.issuer) {
		options.issuer = config.issuer;
	}

	if (config.audience) {
		options.audience = config.audience;
	}

	return options;
};

const buildVerifyOptions = (config: JwtConfig): VerifyOptions => {
	const options: VerifyOptions = {};

	if (config.issuer) {
		options.issuer = config.issuer;
	}

	if (config.audience) {
		options.audience = config.audience;
	}

	return options;
};

export const signAuthToken = (
	user: AuthenticatedUser,
	config: JwtConfig,
): string => {
	const payload = {
		sub: user.id,
		email: user.email,
		role: user.role,
	};

	return jwt.sign(payload, config.secret, buildSignOptions(config));
};

export const signRefreshToken = (
	user: AuthenticatedUser,
	config: JwtConfig,
): string => signAuthToken(user, config);

// Admin session hardening: short-lived, scoped tokens. Members keep the long
// (240d) session; admins get a 30-minute idle window that forces re-login.
export const ADMIN_EXPIRES_IN =
	process.env.JWT_ADMIN_EXPIRES_IN?.trim() || "30m";
const STEP_UP_EXPIRES_IN = process.env.JWT_STEP_UP_EXPIRES_IN?.trim() || "5m";

/** Admin login token: role=admin, scope=admin, short TTL. */
export const signAdminToken = (
	user: AuthenticatedUser,
	config: JwtConfig,
): string => {
	const payload = {
		sub: user.id,
		email: user.email,
		role: user.role,
		scope: "admin",
	};
	return jwt.sign(
		payload,
		config.secret,
		buildSignOptions({ ...config, expiresIn: ADMIN_EXPIRES_IN }),
	);
};

/** Step-up token minted after an admin re-enters their password. */
export const signStepUpToken = (adminId: string, config: JwtConfig): string =>
	jwt.sign(
		{ sub: adminId, scope: "step_up" },
		config.secret,
		buildSignOptions({ ...config, expiresIn: STEP_UP_EXPIRES_IN }),
	);

export const verifyStepUpToken = (
	token: string,
	adminId: string,
	config: JwtConfig,
): boolean => {
	try {
		const payload = jwt.verify(
			token,
			config.secret,
			buildVerifyOptions(config),
		) as JwtPayload;
		return payload.scope === "step_up" && payload.sub === adminId;
	} catch {
		return false;
	}
};

/** Read the `scope` claim off a token WITHOUT re-verifying (already verified). */
export const decodeTokenScope = (token: string): string | null => {
	const decoded = jwt.decode(token);
	if (decoded && typeof decoded === "object") {
		const scope = (decoded as JwtPayload & { scope?: unknown }).scope;
		return typeof scope === "string" ? scope : null;
	}
	return null;
};

export const verifyAuthToken = (
	token: string,
	config: JwtConfig,
): AuthenticatedUser | null => {
	const payload = jwt.verify(
		token,
		config.secret,
		buildVerifyOptions(config),
	) as JwtPayload | string;

	if (!payload || typeof payload !== "object") {
		return null;
	}

	const { sub, email, role } = payload as JwtPayload & {
		email?: unknown;
		role?: unknown;
	};

	if (typeof sub !== "string" || typeof email !== "string") {
		return null;
	}

	if (!isAppUserRole(role)) {
		return null;
	}

	return {
		id: sub,
		email,
		role,
	};
};

export const verifyRefreshToken = (
	token: string,
	config: JwtConfig,
): AuthenticatedUser | null => verifyAuthToken(token, config);
