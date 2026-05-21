import * as jwt from "jsonwebtoken";
import type { JwtPayload, SignOptions, VerifyOptions } from "jsonwebtoken";
import type { AppUserRole, AuthenticatedUser } from "../types/auth";

export type JwtConfig = {
	secret: string;
	issuer?: string;
	audience?: string;
	expiresIn: string;
};

const parseExpiresIn = (value: string | undefined): string => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : "12h";
};

const normalizeOptional = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const isAppUserRole = (value: unknown): value is AppUserRole =>
	value === "user" ||
	value === "admin" ||
	value === "doctor" ||
	value === "trainer";

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
	const secret = process.env.JWT_REFRESH_SECRET?.trim();
	if (!secret) {
		return null;
	}

	return {
		secret,
		issuer: normalizeOptional(process.env.JWT_ISSUER),
		audience: normalizeOptional(process.env.JWT_AUDIENCE),
		expiresIn: parseExpiresIn(process.env.JWT_REFRESH_EXPIRES_IN ?? "30d"),
	};
};

const buildSignOptions = (config: JwtConfig): SignOptions => {
	const options: SignOptions = { expiresIn: config.expiresIn };

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
