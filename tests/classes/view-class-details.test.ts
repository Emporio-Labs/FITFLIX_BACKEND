import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import mongoose from "mongoose";
import { createServer, Server } from "http";
import User from "../../src/models/User";
import Trainer from "../../src/models/Trainer";
import Class from "../../src/models/Class";
import Booking from "../../src/models/Bookings";
import { signAuthToken, getJwtConfig } from "../../src/utils/jwt";

let server: Server;
let apiBase: string;
let jwtToken: string;
let anotherUserToken: string;
let mockUser: any;
let anotherUser: any;
let mockTrainer: any;
let app: any;

beforeAll(async () => {
	// Set environment variables programmatically before importing the app
	process.env.JWT_SECRET = "supersecretjwtkeyforfitflixdevelopment";
	process.env.MONGODB_URL = "mongodb://127.0.0.1:27017/fitflix";

	const appModule = await import("../../src/app");
	app = appModule.default;

	// Connect to database
	const mongoUrl = process.env.MONGODB_URL;
	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUrl);
	}

	// Start the express server on a free port
	server = app.listen(0);
	const address = server.address();
	const port = typeof address === "string" ? 3000 : address?.port;
	apiBase = `http://127.0.0.1:${port}`;

	// Clear test collections
	await User.deleteMany({ email: /@test-class\.com$/ });
	await Trainer.deleteMany({ email: /@test-class\.com$/ });
	await Class.deleteMany({});
	await Booking.deleteMany({});

	// Create a test user
	mockUser = await User.create({
		username: "classTester",
		phone: "1234567890",
		email: "tester@test-class.com",
		age: 25,
		gender: "Male",
		passwordHash: "dummyhash",
	});

	// Create another test user
	anotherUser = await User.create({
		username: "classTester2",
		phone: "0987654321",
		email: "tester2@test-class.com",
		age: 30,
		gender: "Female",
		passwordHash: "dummyhash2",
	});

	// Generate auth tokens
	const jwtConfig = getJwtConfig() || {
		secret: "supersecretjwtkeyforfitflixdevelopment",
		expiresIn: "240d",
	};
	jwtToken = signAuthToken(
		{ id: mockUser._id.toString(), email: mockUser.email, role: "user" },
		jwtConfig,
	);
	anotherUserToken = signAuthToken(
		{ id: anotherUser._id.toString(), email: anotherUser.email, role: "user" },
		jwtConfig,
	);

	// Create a test trainer
	mockTrainer = await Trainer.create({
		trainerName: "Coach Carter",
		email: "carter@test-class.com",
		phone: "5551234567",
		passwordHash: "trainerhash",
		avatarUrl: "https://avatar.url/carter.png",
	});
});

afterAll(async () => {
	// Clean up database
	await User.deleteMany({ email: /@test-class\.com$/ });
	await Trainer.deleteMany({ email: /@test-class\.com$/ });
	await Class.deleteMany({});
	await Booking.deleteMany({});

	// Close server and database connection
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await mongoose.connection.close();
});

describe("GET /api/v1/classes/:id", () => {
	test("should return 401 Unauthorized if no bearer token is provided", async () => {
		const dummyId = new mongoose.Types.ObjectId().toString();
		const response = await fetch(`${apiBase}/api/v1/classes/${dummyId}`);
		expect(response.status).toBe(401);
		
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	test("should return 401 Unauthorized if token is invalid", async () => {
		const dummyId = new mongoose.Types.ObjectId().toString();
		const response = await fetch(`${apiBase}/api/v1/classes/${dummyId}`, {
			headers: { Authorization: "Bearer invalid-token" },
		});
		expect(response.status).toBe(401);
	});

	test("should return 404 Not Found if class ID does not exist", async () => {
		const dummyId = new mongoose.Types.ObjectId().toString();
		const response = await fetch(`${apiBase}/api/v1/classes/${dummyId}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		expect(response.status).toBe(404);
		
		const body = await response.json();
		expect(body.code).toBe("NOT_FOUND");
	});

	test("should return 404 Not Found if class ID is an invalid format (like '1')", async () => {
		const response = await fetch(`${apiBase}/api/v1/classes/1`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		expect(response.status).toBe(404);
		
		const body = await response.json();
		expect(body.code).toBe("NOT_FOUND");
	});

	test("should retrieve details of an offline class with correct trainer format and no meeting details", async () => {
		const offlineClass = await Class.create({
			name: "Introduction to Yoga",
			description: "A beginner friendly yoga session.",
			dateTime: new Date("2026-10-01T10:00:00.000Z"),
			duration: 60,
			creditsCost: 5,
			scheduleType: "FIXED",
			trainer: mockTrainer._id,
			capacity: 20,
			classType: "offline",
			location: "Studio A, 123 Fitness Way",
		});

		const response = await fetch(`${apiBase}/api/v1/classes/${offlineClass._id.toString()}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		expect(response.status).toBe(200);

		const body = await response.json();
		const cls = body.class;
		expect(cls).toBeDefined();
		expect(cls.id).toBe(offlineClass._id.toString());
		expect(cls.name).toBe("Introduction to Yoga");
		expect(cls.description).toBe("A beginner friendly yoga session.");
		expect(new Date(cls.dateTime).toISOString()).toBe(offlineClass.dateTime.toISOString());
		expect(cls.duration).toBe(60);
		expect(cls.creditsCost).toBe(5);
		expect(cls.scheduleType).toBe("FIXED");
		expect(cls.capacity).toBe(20);
		expect(cls.classType).toBe("offline");
		expect(cls.location).toBe("Studio A, 123 Fitness Way");
		expect(cls.meetingInfo).toBeNull();
		expect(cls.availableSeats).toBe(20);

		// Check trainer shape - should only have id, name, avatarUrl
		expect(cls.trainer).toBeDefined();
		expect(cls.trainer.id).toBe(mockTrainer._id.toString());
		expect(cls.trainer.name).toBe("Coach Carter");
		expect(cls.trainer.avatarUrl).toBe("https://avatar.url/carter.png");
		expect(Object.keys(cls.trainer).sort()).toEqual(["avatarUrl", "id", "name"]);
	});

	test("should retrieve details of an online class and return meetingInfo as null if user has no booking", async () => {
		const onlineClass = await Class.create({
			name: "HIIT Cardio",
			description: "High intensity interval training.",
			dateTime: new Date("2026-10-02T18:00:00.000Z"),
			duration: 45,
			creditsCost: 8,
			scheduleType: "RECURRING",
			trainer: mockTrainer._id,
			capacity: 15,
			classType: "online",
			meetingUrl: "https://zoom.us/j/123456789",
			meetingPasscode: "HIIT123",
		});

		const response = await fetch(`${apiBase}/api/v1/classes/${onlineClass._id.toString()}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		expect(response.status).toBe(200);

		const body = await response.json();
		const cls = body.class;
		expect(cls.classType).toBe("online");
		expect(cls.meetingInfo).toBeNull();
		expect(cls.location).toBeNull();
		expect(cls.availableSeats).toBe(15);
	});

	test("should retrieve details of an online class and return meetingInfo if user has an active booking", async () => {
		const onlineClass = await Class.create({
			name: "Pilates Online",
			description: "Core strengthening pilates session.",
			dateTime: new Date("2026-10-03T09:00:00.000Z"),
			duration: 50,
			creditsCost: 7,
			scheduleType: "FIXED",
			trainer: mockTrainer._id,
			capacity: 10,
			classType: "online",
			meetingUrl: "https://zoom.us/j/987654321",
			meetingPasscode: "PILATES77",
		});

		// Create an active booking for mockUser
		const activeBooking = await Booking.create({
			bookingDate: new Date(),
			startTime: "09:00",
			endTime: "09:50",
			status: "Booked",
			user: mockUser._id,
			class_id: onlineClass._id,
			slot: new mongoose.Types.ObjectId(), // dummy slot
			service: new mongoose.Types.ObjectId(), // dummy service
			creditCostSnapshot: 7,
			creditsBypassed: false,
		});

		// Create a non-active booking for another user
		await Booking.create({
			bookingDate: new Date(),
			startTime: "09:00",
			endTime: "09:50",
			status: "Cancelled", // not active
			user: anotherUser._id,
			class_id: onlineClass._id,
			slot: new mongoose.Types.ObjectId(),
			service: new mongoose.Types.ObjectId(),
			creditCostSnapshot: 7,
			creditsBypassed: false,
		});

		// Check details using user with active booking (mockUser)
		const responseUser1 = await fetch(`${apiBase}/api/v1/classes/${onlineClass._id.toString()}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		expect(responseUser1.status).toBe(200);
		const bodyUser1 = await responseUser1.json();
		expect(bodyUser1.class.meetingInfo).not.toBeNull();
		expect(bodyUser1.class.meetingInfo.url).toBe("https://zoom.us/j/987654321");
		expect(bodyUser1.class.meetingInfo.passcode).toBe("PILATES77");

		// Check details using user with no active booking (anotherUser, since booking is cancelled)
		const responseUser2 = await fetch(`${apiBase}/api/v1/classes/${onlineClass._id.toString()}`, {
			headers: { Authorization: `Bearer ${anotherUserToken}` },
		});
		expect(responseUser2.status).toBe(200);
		const bodyUser2 = await responseUser2.json();
		expect(bodyUser2.class.meetingInfo).toBeNull();
	});

	test("should dynamically calculate available seats based on active bookings count", async () => {
		const classWithSeats = await Class.create({
			name: "Spin Class",
			description: "High energy cycling workout.",
			dateTime: new Date("2026-10-04T12:00:00.000Z"),
			duration: 45,
			creditsCost: 6,
			scheduleType: "RECURRING",
			trainer: mockTrainer._id,
			capacity: 5,
			classType: "offline",
			location: "Cycling Studio",
		});

		// Create 2 active bookings
		await Booking.create({
			bookingDate: new Date(),
			startTime: "12:00",
			endTime: "12:45",
			status: "Booked",
			user: mockUser._id,
			class_id: classWithSeats._id,
			slot: new mongoose.Types.ObjectId(),
			service: new mongoose.Types.ObjectId(),
			creditCostSnapshot: 6,
			creditsBypassed: false,
		});

		await Booking.create({
			bookingDate: new Date(),
			startTime: "12:00",
			endTime: "12:45",
			status: "Booked",
			user: anotherUser._id,
			class_id: classWithSeats._id,
			slot: new mongoose.Types.ObjectId(),
			service: new mongoose.Types.ObjectId(),
			creditCostSnapshot: 6,
			creditsBypassed: false,
		});

		// Create 1 cancelled booking
		await Booking.create({
			bookingDate: new Date(),
			startTime: "12:00",
			endTime: "12:45",
			status: "Cancelled",
			user: mockUser._id,
			class_id: classWithSeats._id,
			slot: new mongoose.Types.ObjectId(),
			service: new mongoose.Types.ObjectId(),
			creditCostSnapshot: 6,
			creditsBypassed: false,
		});

		const response = await fetch(`${apiBase}/api/v1/classes/${classWithSeats._id.toString()}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		expect(response.status).toBe(200);

		const body = await response.json();
		// Available seats should be 5 (capacity) - 2 (active bookings) = 3
		expect(body.class.availableSeats).toBe(3);
	});
});
