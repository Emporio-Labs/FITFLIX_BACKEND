import http from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";

export const JWT_SECRET =
	process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

export function generateTestToken(role: string, userId: string): string {
	const config = getJwtConfig() || {
		secret: JWT_SECRET,
		expiresIn: "1h",
	};
	return signAuthToken(
		{ id: userId, email: `${role}@fitflix.test`, role: role as any },
		config,
	);
}

export const adminToken = generateTestToken("admin", "507f1f77bcf86cd799439011");
export const userToken = generateTestToken("user", "507f1f77bcf86cd799439012");

export interface TestServerInstance {
	server: http.Server;
	baseUrl: string;
	close: () => Promise<void>;
}

let portCounter = 3800;

export async function startTestServer(): Promise<TestServerInstance> {
	const mongoUri =
		process.env.MONGODB_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/hybridhuman";

	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUri);
	}

	const port = portCounter++;
	const server = http.createServer(app);

	await new Promise<void>((resolve) => {
		server.listen(port, () => resolve());
	});

	const baseUrl = `http://localhost:${port}`;

	const close = async () => {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	};

	return { server, baseUrl, close };
}

export async function fetchJson(
	baseUrl: string,
	path: string,
	options: {
		method?: string;
		token?: string;
		body?: any;
	} = {},
): Promise<{ status: number; data: any }> {
	const headers: Record<string, string> = {};
	if (options.body) {
		headers["Content-Type"] = "application/json";
	}
	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	const res = await fetch(`${baseUrl}${path}`, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});

	let data: any = {};
	try {
		data = await res.json();
	} catch {}

	return { status: res.status, data };
}

export function assert(condition: boolean, message: string) {
	if (!condition) {
		console.error(`  ❌ FAILED: ${message}`);
		throw new Error(message);
	}
	console.log(`  ✅ ${message}`);
}
