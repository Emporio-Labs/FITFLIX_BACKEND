import type { Request, Response } from "express";
import app from "../src/app";
import {
	isErrorVerboseEnabled,
	resolveErrorResponse,
} from "../src/utils/api-error";
import connectDB from "../src/utils/db";

let dbReadyPromise: Promise<void> | null = null;

const ensureDbConnection = async () => {
	if (!dbReadyPromise) {
		dbReadyPromise = connectDB();
	}

	try {
		await dbReadyPromise;
	} catch (error) {
		dbReadyPromise = null;
		throw error;
	}
};

export default async function handler(req: Request, res: Response) {
	try {
		await ensureDbConnection();
		return app(req, res);
	} catch (error) {
		console.error("Request initialization failed:", error);
		const { status, body } = resolveErrorResponse(error, {
			fallbackMessage: "Server initialization failed",
			verbose: isErrorVerboseEnabled(),
		});
		res.status(status).json(body);
	}
}
