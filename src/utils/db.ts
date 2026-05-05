import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | null = null;

export default async function connectDB(): Promise<void> {
	const connectionUrl = process.env.MONGODB_URL;

	if (!connectionUrl) {
		throw new Error("Empty connection string for MongoDB connection");
	}

	if (mongoose.connection.readyState === 1) {
		return;
	}

	if (!connectionPromise) {
		connectionPromise = mongoose.connect(connectionUrl, {
			serverSelectionTimeoutMS: 5000,
		});
	}

	try {
		await connectionPromise;
		console.log("✅ MongoDB connected");
	} catch (error) {
		connectionPromise = null;
		console.error("❌ MongoDB connection error:", error);
		throw error;
	} finally {
		connectionPromise = null;
	}
}
