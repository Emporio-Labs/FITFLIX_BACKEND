import type { RequestHandler } from "express";
import Lead from "../models/Lead";
import User from "../models/User";
import { Gender, LeadStatus, OnboardingStep } from "../models/Enums";
import type { AuthenticatedUser } from "../types/auth";
import {
	getJwtConfig,
	getJwtRefreshConfig,
	signAuthToken,
	signRefreshToken,
} from "../utils/jwt";
import {
	FirebaseAuthError,
	verifyFirebaseIdToken,
} from "../services/firebase-auth.service";
import {
	phoneRegisterBodySchema,
	phoneVerifyBodySchema,
} from "../validators/auth.validator";

/** Minimal shape we read off a User document to build the auth response. */
type UserAuthDoc = {
	_id: { toString(): string };
	email?: string | null;
	onboarded?: boolean;
	onboardingStatus?: unknown;
};

/** Default onboardingStatus block — mirrors the email/password signup flow. */
const defaultOnboardingStatus = () => ({
	currentStep: OnboardingStep.HEALTH_MARKERS,
	completedSteps: [],
	healthMarkersCompleted: false,
	healthGoalsCompleted: false,
	consentCompleted: false,
	reportsUploaded: false,
	onboardingCompleted: false,
	startedAt: new Date(),
});

/**
 * Build the same auth envelope the email/password `login` handler returns,
 * for a phone-authenticated user. JWTs require a string `email` claim, so we
 * fall back to "" for phone-only accounts.
 */
const buildAuthResponse = (user: UserAuthDoc) => {
	const authUser: AuthenticatedUser = {
		id: user._id.toString(),
		email: user.email ?? "",
		role: "user",
	};

	const jwtConfig = getJwtConfig();
	if (!jwtConfig) {
		return null;
	}

	const accessToken = signAuthToken(authUser, jwtConfig);
	const refreshConfig = getJwtRefreshConfig();
	const refreshToken = refreshConfig
		? signRefreshToken(authUser, refreshConfig)
		: null;

	return {
		accessToken,
		refreshToken,
		tokenType: "Bearer" as const,
		expiresIn: jwtConfig.expiresIn,
		user: {
			id: authUser.id,
			email: authUser.email,
			role: authUser.role,
			onboarded: Boolean(user.onboarded),
			onboardingStatus: user.onboardingStatus ?? null,
		},
	};
};

/** Map a FirebaseAuthError onto the proper HTTP response. */
const handleFirebaseAuthError = (
	error: unknown,
	res: Parameters<RequestHandler>[1],
): boolean => {
	if (!(error instanceof FirebaseAuthError)) {
		return false;
	}

	if (error.code === "FIREBASE_NOT_CONFIGURED") {
		res.status(503).json({
			error: "Phone authentication is not configured",
			code: "NOT_IMPLEMENTED",
		});
		return true;
	}

	res.status(401).json({ error: error.message, code: "UNAUTHORIZED" });
	return true;
};

/**
 * POST /auth/phone/verify
 * Verifies a Firebase ID token. Returning users get a full login response;
 * brand-new phone numbers get `{ isNewUser: true }` and NO user is created.
 */
export const verifyPhone: RequestHandler = async (req, res, next) => {
	const parsed = phoneVerifyBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: parsed.error.issues,
		});
		return;
	}

	let identity: { firebaseUid: string; phoneNumber: string };
	try {
		identity = await verifyFirebaseIdToken(parsed.data.firebaseIdToken);
	} catch (error) {
		if (handleFirebaseAuthError(error, res)) return;
		next(error);
		return;
	}

	const { firebaseUid, phoneNumber } = identity;
	const last10 = phoneNumber.replace(/\D/g, "").slice(-10);

	try {
		// Prefer the stable Firebase UID; fall back to phone to link pre-existing
		// accounts created before phone auth existed.
		let user = await User.findOne({ firebaseUid }).select(
			"email onboarded onboardingStatus",
		);

		if (!user) {
			user = await User.findOne({ phone: { $regex: new RegExp(last10 + "$") } }).select(
				"email onboarded onboardingStatus firebaseUid",
			);

			// Backfill firebaseUid on a legacy account matched by phone.
			if (user && !(user as { firebaseUid?: string }).firebaseUid) {
				await User.updateOne(
					{ _id: user._id },
					{ $set: { firebaseUid, phoneVerified: true, phone: last10 } },
				);
			}
		}

		if (!user) {
			res.status(200).json({ isNewUser: true, phoneNumber: last10 });
			return;
		}

		const auth = buildAuthResponse(user);
		if (!auth) {
			res.status(503).json({
				error: "JWT authentication is not configured",
				code: "NOT_IMPLEMENTED",
			});
			return;
		}

		res.status(200).json({
			message: "Login successful",
			isNewUser: false,
			...auth,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /auth/phone/register
 * First-time account creation after OTP verification. Creates the user with the
 * basic profile, upserts the Lead (keyed by phone), and returns a login response.
 */
export const registerPhone: RequestHandler = async (req, res, next) => {
	const parsed = phoneRegisterBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: parsed.error.issues,
		});
		return;
	}

	let identity: { firebaseUid: string; phoneNumber: string };
	try {
		identity = await verifyFirebaseIdToken(parsed.data.firebaseIdToken);
	} catch (error) {
		if (handleFirebaseAuthError(error, res)) return;
		next(error);
		return;
	}

	const { firebaseUid, phoneNumber } = identity;
	const { name, goal, age, gender } = parsed.data;
	const last10 = phoneNumber.replace(/\D/g, "").slice(-10);

	try {
		// Idempotency: if the account already exists, return its login response
		// instead of creating a duplicate.
		const existing = await User.findOne({
			$or: [{ firebaseUid }, { phone: { $regex: new RegExp(last10 + "$") } }],
		}).select("email onboarded onboardingStatus");

		if (existing) {
			const auth = buildAuthResponse(existing);
			if (!auth) {
				res.status(503).json({
					error: "JWT authentication is not configured",
					code: "NOT_IMPLEMENTED",
				});
				return;
			}
			res.status(200).json({ message: "Login successful", isNewUser: false, ...auth });
			return;
		}

		let createdUser: UserAuthDoc;
		try {
			createdUser = await User.create({
				username: name,
				phone: last10,
				firebaseUid,
				phoneVerified: true,
				age,
				gender: gender as Gender,
				goal,
				onboardingStatus: defaultOnboardingStatus(),
			});
		} catch (error) {
			// Race: another request created the account between our check and create.
			if ((error as { code?: number }).code === 11000) {
				const raced = await User.findOne({
					$or: [{ firebaseUid }, { phone: { $regex: new RegExp(last10 + "$") } }],
				}).select("email onboarded onboardingStatus");
				if (raced) {
					const auth = buildAuthResponse(raced);
					if (auth) {
						res
							.status(200)
							.json({ message: "Login successful", isNewUser: false, ...auth });
						return;
					}
				}
			}
			throw error;
		}

		// Upsert the Lead by phone — reuses the existing funnel/workflow.
		// Non-fatal: a CRM sync failure must not fail account creation.
		try {
			await Lead.findOneAndUpdate(
				{ phone: { $regex: new RegExp(last10 + "$") } },
				{
					$set: {
						leadName: name,
						phone: last10,
						// Lead has no age/gender columns — keep them in the existing
						// notes field to avoid any Lead schema redesign.
						notes: `Age: ${age}, Gender: ${gender}`,
						interestedIn: goal,
						source: "app-signup",
						status: LeadStatus.New,
						convertedUser: createdUser._id,
					},
					$addToSet: { tags: { $each: ["signup", "app-signup"] } },
				},
				{ upsert: true, new: true },
			);
		} catch (err) {
			console.error(
				"[AUTH][PHONE-REGISTER] Lead upsert failed — signup still succeeded:",
				err,
			);
		}

		const auth = buildAuthResponse(createdUser);
		if (!auth) {
			res.status(503).json({
				error: "JWT authentication is not configured",
				code: "NOT_IMPLEMENTED",
			});
			return;
		}

		res.status(201).json({
			message: "User signup successful",
			isNewUser: true,
			...auth,
		});
	} catch (error) {
		next(error);
	}
};
