import path from "node:path";
import { config } from "dotenv";
import express from "express";
import { apiRateLimit } from "./middleware/rate-limit.middleware";
import adminRouter from "./routes/admin.routes";
import authRouter from "./routes/auth.routes";
import billingRouter from "./routes/billing.routes";
import bookingRouter from "./routes/booking.routes";
import classRouter from "./routes/class.routes";
import classScheduleRouter from "./routes/class-schedule.routes";
import contentRouter from "./routes/content.routes";
import locationRouter from "./routes/location.routes";
import personalTrainingRouter from "./routes/personal-training.routes";
import promotionRouter from "./routes/promotion.routes";

import communityAdminRouter from "./routes/community-admin.routes";
import communityPublicRouter from "./routes/community-public.routes";
import communityRouter from "./routes/community.routes";
import creditRouter from "./routes/credit.routes";
import dashboardRouter from "./routes/dashboard.routes";
import deleteAccountRouter from "./routes/delete-account.routes";
import exerciseRouter from "./routes/exercise.routes";
import gymVisitRouter from "./routes/gymVisit.routes";
import internalRouter from "./routes/internal.routes";
import invoiceRouter from "./routes/invoice.routes";
import leadRouter from "./routes/lead.routes";
import membershipRouter from "./routes/membership.routes";
import membershipPlanRouter from "./routes/membershipPlan.routes";
import notificationRouter from "./routes/notification.routes";
import nutritionRouter from "./routes/nutrition.routes";
import nutritionistBookingRouter from "./routes/nutritionist-booking.routes";

import onboardingRouter from "./routes/onboarding.routes";
import scheduleRouter from "./routes/schedule.routes";
import serviceRouter from "./routes/service.routes";
import slotRouter from "./routes/slot.routes";
import therapyRouter from "./routes/therapy.routes";
import trainerRouter from "./routes/trainer.routes";
import userRouter from "./routes/user.routes";
import workoutRouter from "./routes/workout.routes";
import workoutPlanRouter from "./routes/workout-plan.routes";
import zegoRouter from "./routes/zego.routes";
import settingsRouter from "./routes/settings.routes";
import { getApp } from "./services/fcm.service";
import {
	isErrorVerboseEnabled,
	normalizeErrorResponse,
	resolveErrorResponse,
} from "./utils/api-error";

config();

const app = express();

// Behind a tunnel/proxy (ngrok in dev, Vercel in prod) the socket is local —
// without this, `req.protocol` reads "http" and `req.ip` reads the proxy, so
// absolute URLs handed to the app come back as cleartext links that Android
// blocks. Trusting X-Forwarded-Proto / -For fixes both.
app.set("trust proxy", true);

const isProduction = process.env.NODE_ENV === "production";
const isCorsDebugEnabled = process.env.CORS_DEBUG === "true";
const rawAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
	.split(",")
	.map((origin) => origin.trim())
	.filter((origin) => origin.length > 0);
const hasWildcardOrigin = rawAllowedOrigins.includes("*");
const allowedOrigins = [
	"http://localhost:3000",
	"http://localhost:3001",
	"http://localhost:5173",
	"*.vercel.app",
	"https://*.vercel.app",
	...rawAllowedOrigins.filter((origin) => origin !== "*"),
];
const allowAnyOrigin =
	hasWildcardOrigin || (!isProduction && rawAllowedOrigins.length === 0);

const isOriginAllowed = (origin: string | undefined): boolean => {
	if (!origin) {
		return false;
	}

	if (allowAnyOrigin) {
		return true;
	}

	if (allowedOrigins.includes(origin)) {
		return true;
	}

	try {
		const parsed = new URL(origin);
		if (
			parsed.hostname === "localhost" ||
			parsed.hostname.endsWith(".vercel.app") ||
			parsed.hostname.endsWith(".vercel.dev")
		) {
			return true;
		}
	} catch (_) {
		// Ignore invalid URL parse errors
	}

	return allowedOrigins.some((pattern) => {
		if (pattern === "*") {
			return true;
		}
		if (pattern.includes("*")) {
			try {
				const regexStr = `^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`;
				return new RegExp(regexStr, "i").test(origin);
			} catch (e) {
				console.error(`[CORS] Invalid wildcard pattern: ${pattern}`, e);
				return false;
			}
		}
		return pattern === origin;
	});
};

app.use((req, res, next) => {
	const origin = req.header("origin");
	const originAllowed = origin ? isOriginAllowed(origin) : false;

	if (isCorsDebugEnabled) {
		console.log(
			`[CORS] origin=${origin ?? "(none)"} allowed=${originAllowed} allowAny=${allowAnyOrigin} allowList=${allowedOrigins.join(";") || "(empty)"}`,
		);
	}

	if (origin && originAllowed) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
		res.setHeader("Access-Control-Allow-Credentials", "true");
	}

	res.setHeader(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,PATCH,DELETE,OPTIONS",
	);
	res.setHeader(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, X-Captcha-Token, X-Webhook-Secret, X-Step-Up-Token, ngrok-skip-browser-warning",
	);
	res.setHeader(
		"Access-Control-Expose-Headers",
		"X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Total-Count, Content-Disposition",
	);
	res.setHeader("Access-Control-Max-Age", "86400");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.setHeader(
		"Permissions-Policy",
		"geolocation=(), microphone=(), camera=()",
	);
	res.setHeader("Cross-Origin-Resource-Policy", "same-site");
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
	);

	if (isProduction) {
		res.setHeader(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);
	}

	if (req.method === "OPTIONS") {
		if (origin && !originAllowed) {
			res.status(403).json({ message: "CORS origin denied" });
			return;
		}

		res.sendStatus(204);
		return;
	}

	next();
});

// Body cap raised well past express's 100kb default: a post now carries an
// unbounded number of image references, and each one is a handful of URLs.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "25mb" }));
app.use((_req, res, next) => {
	const originalJson = res.json.bind(res);
	res.json = ((body: unknown) => {
		if (res.statusCode < 400) {
			return originalJson(body as never);
		}

		return originalJson(
			normalizeErrorResponse({
				status: res.statusCode,
				body,
				verbose: isErrorVerboseEnabled(),
			}) as never,
		);
	}) as typeof res.json;

	next();
});

app.use((req, res, next) => {
	const start = Date.now();

	console.log(`[REQ] ${req.method} ${req.originalUrl}`);

	res.on("finish", () => {
		const durationMs = Date.now() - start;
		console.log(
			`[RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`,
		);
	});

	next();
});

// Root, health, and favicon endpoints
app.get("/", (_req, res) => {
	res.status(200).json({ ok: true, message: "Fitflix API Backend" });
});

app.get("/health", (_req, res) => {
	res.status(200).json({ ok: true });
});

app.get("/favicon.ico", (_req, res) => {
	res.status(204).end();
});

app.get("/favicon.png", (_req, res) => {
	res.status(204).end();
});

app.use("/auth", authRouter);
app.use("/api/v1/auth", authRouter);
app.use("/delete-account", deleteAccountRouter);
app.use("/admins", adminRouter);
app.use("/trainers", trainerRouter);
app.use("/users", userRouter);
app.use("/memberships", membershipRouter);
app.use("/slots", slotRouter);
app.use("/services", serviceRouter);
app.use("/therapies", therapyRouter);
app.use("/bookings", apiRateLimit, bookingRouter);
app.use("/api/v1/bookings", apiRateLimit, bookingRouter);
app.use("/api/v1/admin/bookings", apiRateLimit, bookingRouter);
app.use("/credits", apiRateLimit, creditRouter);
app.use("/api/v1/credits", apiRateLimit, creditRouter);
app.use("/schedules", apiRateLimit, scheduleRouter);
app.use("/exercises", apiRateLimit, exerciseRouter);
app.use("/leads", apiRateLimit, leadRouter);
app.use("/gym-visits", apiRateLimit, gymVisitRouter);
app.use("/invoices", apiRateLimit, invoiceRouter);
app.use("/api/invoices", apiRateLimit, invoiceRouter);
// Mounted before the bare "/api/v1" routers below. classRouter and
// classScheduleRouter are mounted at "/api/v1" itself and each call
// router.use(authenticateToken), so they match every /api/v1/* path that
// reaches them — anything registered after them loses its public routes to a
// 401. /api/v1/promotions/public did exactly that.
app.use("/api/v1/promotions", apiRateLimit, promotionRouter);
app.use("/promotions", apiRateLimit, promotionRouter);
// Same ordering constraint as promotions above: /api/v1/content/public must be
// matched before the routers mounted at bare "/api/v1", or it answers 401.
app.use("/api/v1/content", apiRateLimit, contentRouter);
app.use("/content", apiRateLimit, contentRouter);
app.use("/api/v1", classScheduleRouter);
app.use("/api/v1", classRouter);
app.use("/api/v1/zego", zegoRouter);
app.use("/api/v1/admin/settings", settingsRouter);
app.use("/membership-plans", membershipPlanRouter);
app.use("/onboarding", onboardingRouter);
app.use(nutritionistBookingRouter);
app.use("/api/v1", nutritionistBookingRouter);
app.use("/nutrition", nutritionRouter);
app.use("/dashboard", dashboardRouter);
app.use("/workout-plans", workoutPlanRouter);
app.use("/workouts", workoutRouter);
app.use("/api/v1/locations", apiRateLimit, locationRouter);
app.use("/api/v1/pt", apiRateLimit, personalTrainingRouter);
app.use("/pt", apiRateLimit, personalTrainingRouter);
app.use("/api/v1/billing", apiRateLimit, billingRouter);
app.use("/billing", apiRateLimit, billingRouter);
app.use("/notifications", notificationRouter);
// Admin moderation and the unauthenticated public surface must both be mounted
// BEFORE the member router — that one authenticates every request, so anything
// falling through to it answers 401 instead of reaching its own handler.
app.use("/community/admin", communityAdminRouter);
app.use("/community/public", communityPublicRouter);
app.use("/community", communityRouter);
app.use("/internal", internalRouter);

app.get("/health", (_req, res) => {
	res.status(200).json({ ok: true });
});

app.post("/test/firebase", (_req, res) => {
	try {
		console.log(
			"[test-firebase] POST /test/firebase triggered. Initializing Firebase...",
		);
		const appInstance = getApp();
		if (appInstance) {
			res.status(200).json({
				success: true,
				message: "Firebase Admin initialized successfully",
				projectName: appInstance.options.projectId || "unknown",
			});
		} else {
			res.status(500).json({
				success: false,
				message:
					"Firebase Admin initialization failed or was disabled (check server logs)",
			});
		}
	} catch (err: any) {
		console.error("[test-firebase] Exception during Firebase Admin test:", err);
		res.status(500).json({
			success: false,
			message: "Firebase Admin test threw an exception",
			error: err?.message || String(err),
		});
	}
});

app.use(
	(
		error: unknown,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) => {
		if (res.headersSent) {
			return;
		}

		console.error("[UNHANDLED_ERROR]", error);

		const { status, body } = resolveErrorResponse(error, {
			verbose: isErrorVerboseEnabled(),
		});
		res.status(status).json(body);
	},
);

export default app;
