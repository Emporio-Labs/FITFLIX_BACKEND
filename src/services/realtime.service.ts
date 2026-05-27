import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { verifyAuthToken, getJwtConfig } from "../utils/jwt";

export type FrontDeskEvent =
	| "appointment_created"
	| "slot_consumed"
	| "slot_released"
	| "onboarding_progress_changed";

export type UserEvent =
	| "appointment_booked"
	| "appointment_rescheduled"
	| "appointment_cancelled"
	| "appointment_reminder"
	| "onboarding_step_updated";

export type NutritionistEvent =
	| "new_user_assigned"
	| "appointment_added"
	| "appointment_rescheduled";

let io: SocketIOServer | null = null;

/** Call once from index.ts after creating the HTTP server. */
export function initSocketIO(httpServer: HttpServer): SocketIOServer {
	io = new SocketIOServer(httpServer, {
		path: process.env.SOCKET_IO_PATH ?? "/socket.io",
		cors: {
			origin: (process.env.CORS_ALLOWED_ORIGINS ?? "")
				.split(",")
				.map((o) => o.trim())
				.filter(Boolean),
			methods: ["GET", "POST"],
			credentials: false,
		},
		transports: ["websocket", "polling"],
	});

	// JWT authentication middleware for all socket connections
	io.use((socket: Socket, next: any) => {
		const token =
			socket.handshake.auth?.token ??
			(socket.handshake.headers.authorization ?? "").replace("Bearer ", "");

		if (!token) {
			next(new Error("Missing auth token"));
			return;
		}

		const config = getJwtConfig();
		if (!config) {
			next(new Error("JWT not configured"));
			return;
		}

		const user = verifyAuthToken(token, config);
		if (!user) {
			next(new Error("Invalid or expired token"));
			return;
		}

		// Attach user to socket data
		socket.data.user = user;
		next();
	});

	io.on("connection", (socket: Socket) => {
		const user = socket.data.user as { id: string; role: string } | undefined;
		if (!user) {
			socket.disconnect();
			return;
		}

		// Join personal room
		void socket.join(`user:${user.id}`);

		// Join role rooms
		if (user.role === "admin") {
			void socket.join("frontdesk");
		}
		if (user.role === "nutritionist") {
			void socket.join(`nutritionist:${user.id}`);
		}

		socket.on("disconnect", () => {
			// Cleanup is automatic — rooms are vacated on disconnect
		});
	});

	console.log("[socket.io] Server initialized");
	return io;
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

export function emitToUser(
	userId: string,
	event: UserEvent,
	data: unknown,
): void {
	if (!io) return;
	io.to(`user:${userId}`).emit(event, data);
}

export function emitToFrontDesk(
	event: FrontDeskEvent,
	data: unknown,
): void {
	if (!io) return;
	io.to("frontdesk").emit(event, data);
}

export function emitToNutritionist(
	nutritionistId: string,
	event: NutritionistEvent,
	data: unknown,
): void {
	if (!io) return;
	io.to(`nutritionist:${nutritionistId}`).emit(event, data);
}

export function getIO(): SocketIOServer | null {
	return io;
}
