import { config } from "dotenv";
import express from "express";
import adminRouter from "./routes/admin.routes";
import appointmentRouter from "./routes/appointment.routes";
import authRouter from "./routes/auth.routes";
import bookingRouter from "./routes/booking.routes";
import creditRouter from "./routes/credit.routes";
import doctorRouter from "./routes/doctor.routes";
import exerciseRouter from "./routes/exercise.routes";
import leadRouter from "./routes/lead.routes";
import membershipRouter from "./routes/membership.routes";
import nutritionistRouter from "./routes/nutritionist-booking.routes";
import onboardingRouter from "./routes/onboarding.routes";
import scheduleRouter from "./routes/schedule.routes";
import serviceRouter from "./routes/service.routes";
import slotRouter from "./routes/slot.routes";
import therapyRouter from "./routes/therapy.routes";
import trainerRouter from "./routes/trainer.routes";
import userRouter from "./routes/user.routes";
import webhookRouter from "./routes/webhook.route";
import workoutPlanRouter from "./routes/workout-plan.routes";
import workoutRouter from "./routes/workout.routes";
import {
	isErrorVerboseEnabled,
	normalizeErrorResponse,
	resolveErrorResponse,
} from "./utils/api-error";

config();

const app = express();

const isProduction = process.env.NODE_ENV === "production";
const isCorsDebugEnabled = process.env.CORS_DEBUG === "true";
const rawAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
	.split(",")
	.map((origin) => origin.trim())
	.filter((origin) => origin.length > 0);
const hasWildcardOrigin = rawAllowedOrigins.includes("*");
const allowedOrigins = rawAllowedOrigins.filter((origin) => origin !== "*");
const allowAnyOrigin =
	!isProduction && (allowedOrigins.length === 0 || hasWildcardOrigin);

const isOriginAllowed = (origin: string | undefined): boolean => {
	if (!origin) {
		return false;
	}

	if (allowAnyOrigin) {
		return true;
	}

	return allowedOrigins.includes(origin);
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
		res.setHeader(
			"Access-Control-Allow-Origin",
			allowAnyOrigin ? "*" : origin,
		);

		if (!allowAnyOrigin) {
			res.setHeader("Vary", "Origin");
		}
	}

	res.setHeader(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,PATCH,DELETE,OPTIONS",
	);
	res.setHeader(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, X-Captcha-Token, X-Webhook-Secret",
	);
	res.setHeader("Access-Control-Allow-Credentials", "false");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
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
		if (origin && !isOriginAllowed(origin)) {
			res.status(403).json({ message: "CORS origin denied" });
			return;
		}

		res.sendStatus(204);
		return;
	}

	next();
});

app.use(express.json());
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

app.use("/auth", authRouter);
app.use("/admins", adminRouter);
app.use("/doctors", doctorRouter);
app.use("/trainers", trainerRouter);
app.use("/users", userRouter);
app.use("/memberships", membershipRouter);
app.use("/slots", slotRouter);
app.use("/services", serviceRouter);
app.use("/therapies", therapyRouter);
app.use("/bookings", bookingRouter);
app.use("/credits", creditRouter);
app.use("/appointments", appointmentRouter);
app.use("/schedules", scheduleRouter);
app.use("/exercises", exerciseRouter);
app.use("/leads", leadRouter);
app.use("/onboarding", onboardingRouter);
app.use("/nutritionist", nutritionistRouter);
app.use("/webhook", webhookRouter);
app.use("/workout-plans", workoutPlanRouter);
app.use("/workouts", workoutRouter);

app.get("/health", (_req, res) => {
	res.status(200).json({ ok: true });
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
