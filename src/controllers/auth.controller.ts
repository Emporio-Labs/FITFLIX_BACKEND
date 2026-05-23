import type { RequestHandler } from "express";
import Admin from "../models/Admin";
import Doctor from "../models/Doctor";
import Trainer from "../models/Trainer";
import User from "../models/User";
import {
	hashPassword,
	isHashedPassword,
	verifyPassword,
} from "../utils/password";
import {
	getJwtConfig,
	getJwtRefreshConfig,
	signAuthToken,
	signRefreshToken,
	verifyRefreshToken,
} from "../utils/jwt";
import {
	loginBodySchema,
	refreshTokenBodySchema,
	signupBodySchema,
} from "../validators/auth.validator";

type AppRole = "user" | "admin" | "doctor" | "trainer";

type AuthDocument = {
	_id: { toString(): string };
	email: string;
	passwordHash: string;
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
	if (!account) {
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
		email: account.email,
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

	const { username, phone, email, age, gender, healthGoals, password } =
		parsedBody.data;

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
			gender,
			healthGoals,
			onboarded: false,
			passwordHash,
		});

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

		const matchedAccount =
			(await matchAccount(password, "user", user)) ??
			(await matchAccount(password, "admin", admin)) ??
			(await matchAccount(password, "doctor", doctor)) ??
			(await matchAccount(password, "trainer", trainer));

		if (!matchedAccount) {
			console.log("[AUTH][LOGIN] Invalid credentials", {
				email,
				userFound: Boolean(user),
				adminFound: Boolean(admin),
			});

			res.status(401).json({ message: "Invalid email or password" });
			return;
		}

		req.user = matchedAccount;

		const jwtConfig = getJwtConfig();
		if (!jwtConfig) {
			res.status(503).json({ message: "JWT authentication is not configured" });
			return;
		}

		const accessToken = signAuthToken(matchedAccount, jwtConfig);
		const refreshConfig = getJwtRefreshConfig();
		const refreshToken = refreshConfig
			? signRefreshToken(matchedAccount, refreshConfig)
			: null;

		const userPayload = buildLoginUserPayload(matchedAccount, user);

		console.log("[AUTH][LOGIN] Login successful", {
			email,
			userId: req.user.id,
			role: req.user.role,
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
