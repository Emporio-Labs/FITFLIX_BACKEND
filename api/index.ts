import type { Request, Response } from "express";
import app from "../src/app";
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
		res.status(500).json({ message: "Server initialization failed" });
	}
}
