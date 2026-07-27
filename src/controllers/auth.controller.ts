import type { RequestHandler } from "express";
import Admin from "../models/Admin";
import Doctor from "../models/Doctor";
import { type Gender, LeadStatus, OnboardingStep } from "../models/Enums";
import Lead from "../models/Lead";
import TokenBlacklist from "../models/TokenBlacklist";
import Trainer from "../models/Trainer";
import User from "../models/User";
import {
	getJwtConfig,
	getJwtRefreshConfig,
	signAdminToken,
	signAuthToken,
	signRefreshToken,
	verifyRefreshToken,
} from "../utils/jwt";
import {
	hashPassword,
	isHashedPassword,
	verifyPassword,
} from "../utils/password";
import {
	loginBodySchema,
	refreshTokenBodySchema,
	signupBodySchema,
} from "../validators/auth.validator";

type AppRole = "user" | "admin" | "doctor" | "trainer";

// ── Login lockout (in-memory; staff accounts are the top target) ──────────────
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOGIN_LOCKOUT_MS =
	(Number(process.env.LOGIN_LOCKOUT_MINUTES) || 15) * 60_000;
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

const isLoginLocked = (email: string): boolean => {
	const entry = loginAttempts.get(email);
	return entry ? Date.now() < entry.lockedUntil : false;
};
const recordLoginFailure = (email: string): void => {
	const entry = loginAttempts.get(email) ?? { count: 0, lockedUntil: 0 };
	entry.count += 1;
	if (entry.count >= LOGIN_MAX_ATTEMPTS) {
		entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
	}
	loginAttempts.set(email, entry);
};
const clearLoginFailures = (email: string): void => {
	loginAttempts.delete(email);
};

type AuthDocument = {
	_id: { toString(): string };
	// Phone-auth users may have no email/passwordHash; email/password login
	// still requires both, which is guarded in matchAccount below.
	email?: string | null;
	passwordHash?: string | null;
	save: () => Promise<unknown>;
	onboarded?: boolean;
	onboardingStatus?: unknown;
};

type LoginUserPayload = {
	id: string;
	email: string;
	role: AppRole;
	onboarded?: boolean;
	onboardingStatus?: unknown;
};

const matchAccount = async (
	password: string,
	role: AppRole,
	account: AuthDocument | null,
) => {
	if (!account || !account.passwordHash) {
		return null;
	}

	const valid = await verifyPassword(password, account.passwordHash);
	if (!valid) {
		return null;
	}

	if (!isHashedPassword(account.passwordHash)) {
		account.passwordHash = await hashPassword(password);
		await account.save();
	}

	return {
		id: account._id.toString(),
		email: account.email ?? "",
		role,
	} as const;
};

const buildLoginUserPayload = (
	matchedAccount: { id: string; email: string; role: AppRole },
	userAccount: AuthDocument | null,
): LoginUserPayload => {
	if (matchedAccount.role !== "user") {
		return {
			id: matchedAccount.id,
			email: matchedAccount.email,
			role: matchedAccount.role,
		};
	}

	return {
		id: matchedAccount.id,
		email: matchedAccount.email,
		role: matchedAccount.role,
		onboarded: Boolean(userAccount?.onboarded),
		onboardingStatus: userAccount?.onboardingStatus ?? null,
	};
};

export const signup: RequestHandler = async (req, res, next) => {
	const parsedBody = signupBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid signup data",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { username, phone, email, age, gender, password } = parsedBody.data;

	try {
		const passwordHash = await hashPassword(password);

		const existingUser = await User.findOne({ email }).select("_id");

		if (existingUser) {
			res.status(409).json({ message: "User with this email already exists" });
			return;
		}

		const createdUser = await User.create({
			username,
			phone,
			email,
			age,
			gender: gender as Gender,
			onboarded: false,
			passwordHash,
			onboardingStatus: {
				currentStep: OnboardingStep.HEALTH_MARKERS,
				completedSteps: [],
				healthMarkersCompleted: false,
				healthGoalsCompleted: false,
				consentCompleted: false,
				reportsUploaded: false,
				sportsScientistBooked: false,
				nutritionistBooked: false,
				onboardingCompleted: false,
				startedAt: new Date(),
			},
		});

		// Upsert CRM lead — awaited so failures are visible, but a lead sync
		// error does NOT fail the signup (user account was already created).
		try {
			await Lead.findOneAndUpdate(
				{ email },
				{
					$set: {
						leadName: username,
						phone: phone ?? "",
						source: "app-signup",
						status: LeadStatus.Converted,
						convertedUser: createdUser._id,
					},
					$addToSet: { tags: { $each: ["signup", "app-signup"] } },
				},
				{ upsert: true, new: true },
			);
		} catch (err) {
			// Non-fatal: user account exists; CRM sync can be retried manually.
			console.error(
				"[AUTH][SIGNUP] Lead upsert failed — signup still succeeded:",
				err,
			);
		}

		res.status(201).json({
			message: "User signup successful",
			userId: createdUser._id,
			onboarded: createdUser.onboarded,
		});
	} catch (error) {
		next(error);
	}
};

export const login: RequestHandler = async (req, res, next) => {
	console.log("[AUTH][LOGIN] Request received", {
		path: req.originalUrl,
		method: req.method,
		hasBody: Boolean(req.body),
	});

	const parsedBody = loginBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		console.log("[AUTH][LOGIN] Validation failed", {
			errors: parsedBody.error.issues,
		});

		res.status(400).json({
			message: "Invalid login data",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { email, password } = parsedBody.data;

	if (isLoginLocked(email)) {
		res.status(429).json({
			message:
				"Too many failed login attempts. Please try again in a few minutes.",
		});
		return;
	}

	try {
		console.log("[AUTH][LOGIN] Looking up user/admin/doctor/trainer", {
			email,
		});

		const [user, admin, doctor, trainer] = await Promise.all([
			User.findOne({ email }).select("+passwordHash"),
			Admin.findOne({ email }).select("+passwordHash"),
			Doctor.findOne({ email }).select("+passwordHash"),
			Trainer.findOne({ email }).select("+passwordHash"),
		]);

		console.log("[AUTH][LOGIN] Model lookups completed", {
			email,
			userFound: Boolean(user),
			adminFound: Boolean(admin),
			doctorFound: Boolean(doctor),
			trainerFound: Boolean(trainer),
		});

		const matchedAccount =
			(await matchAccount(password, "user", user)) ??
			(await matchAccount(password, "admin", admin)) ??
			(await matchAccount(password, "doctor", doctor)) ??
			(await matchAccount(password, "trainer", trainer));

		if (!matchedAccount) {
			recordLoginFailure(email);
			console.log("[AUTH][LOGIN] Invalid credentials", {
				email,
				userFound: Boolean(user),
				adminFound: Boolean(admin),
			});

			res.status(401).json({ message: "Invalid email or password" });
			return;
		}

		clearLoginFailures(email);
		req.user = matchedAccount;

		const jwtConfig = getJwtConfig();
		if (!jwtConfig) {
			res.status(503).json({ message: "JWT authentication is not configured" });
			return;
		}

		// Admins get a short-lived, scoped session; everyone else keeps the long
		// (240d) member session.
		const accessToken =
			matchedAccount.role === "admin"
				? signAdminToken(matchedAccount, jwtConfig)
				: signAuthToken(matchedAccount, jwtConfig);
		const refreshConfig = getJwtRefreshConfig();
		const refreshToken = refreshConfig
			? signRefreshToken(matchedAccount, refreshConfig)
			: null;

		const userPayload = buildLoginUserPayload(matchedAccount, user);

		console.log("[AUTH][LOGIN] Login successful", {
			email,
			userId: req.user.id,
			role: req.user.role,
			userPayloadRole: userPayload.role,
			userPayloadOnboarded: userPayload.onboarded,
		});

		res.status(200).json({
			message: "Login successful",
			accessToken,
			refreshToken,
			tokenType: "Bearer",
			expiresIn: jwtConfig.expiresIn,
			user: userPayload,
		});
	} catch (error) {
		console.error("[AUTH][LOGIN] Unexpected error", error);
		next(error);
	}
};

export const refreshAccessToken: RequestHandler = async (req, res, next) => {
	const parsedBody = refreshTokenBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid refresh token payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const refreshConfig = getJwtRefreshConfig();
	if (!refreshConfig) {
		res.status(503).json({ message: "JWT refresh is not configured" });
		return;
	}

	let user: ReturnType<typeof verifyRefreshToken> = null;
	try {
		user = verifyRefreshToken(parsedBody.data.refreshToken, refreshConfig);
	} catch (_error) {
		res.status(401).json({ message: "Invalid or expired refresh token" });
		return;
	}

	if (!user) {
		res.status(401).json({ message: "Invalid or expired refresh token" });
		return;
	}

	const jwtConfig = getJwtConfig();
	if (!jwtConfig) {
		res.status(503).json({ message: "JWT authentication is not configured" });
		return;
	}

	try {
		const accessToken = signAuthToken(user, jwtConfig);
		res.status(200).json({
			message: "Token refreshed",
			accessToken,
			tokenType: "Bearer",
			expiresIn: jwtConfig.expiresIn,
		});
	} catch (error) {
		next(error);
	}
};

/** Logout — blacklists the current access token so it cannot be reused. */
export const logout: RequestHandler = async (req, res, next) => {
	const authorization = req.header("authorization");
	const parts = authorization?.split(" ") ?? [];
	const token =
		parts[0] === "Bearer" && parts[1]?.trim() ? parts[1].trim() : null;

	if (!token) {
		res.status(400).json({ message: "Missing Bearer token" });
		return;
	}

	try {
		const config = getJwtConfig();
		// Parse the expiry string (e.g. "12h", "7200") into milliseconds so the
		// blacklist entry auto-deletes when the token would have expired anyway.
		const expiresIn = config?.expiresIn ?? "12h";
		const expiresAt = new Date(Date.now() + parseExpiryMs(expiresIn));

		// insertOne with upsert to tolerate duplicate logout calls gracefully
		await TokenBlacklist.updateOne(
			{ token },
			{ $setOnInsert: { token, userId: req.user?.id, expiresAt } },
			{ upsert: true },
		);

		res.status(200).json({ message: "Logged out successfully" });
	} catch (error) {
		next(error);
	}
};

/** Convert a JWT expiresIn string ("12h", "30d", "3600") to milliseconds. */
function parseExpiryMs(value: string): number {
	const num = parseInt(value, 10);
	if (!Number.isNaN(num) && String(num) === value) return num * 1000; // raw seconds
	const unit = value.slice(-1);
	const amount = parseInt(value.slice(0, -1), 10);
	if (Number.isNaN(amount)) return 12 * 60 * 60 * 1000; // fallback: 12h
	switch (unit) {
		case "s":
			return amount * 1000;
		case "m":
			return amount * 60 * 1000;
		case "h":
			return amount * 60 * 60 * 1000;
		case "d":
			return amount * 24 * 60 * 60 * 1000;
		default:
			return 12 * 60 * 60 * 1000;
	}
}
