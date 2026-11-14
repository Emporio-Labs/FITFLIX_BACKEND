import mongoose from "mongoose";
import Bookings from "../src/models/Bookings";
import { BookingStatus, ServiceCategory, ServiceSubtype, UnifiedBookingStatus, AppointmentMode } from "../src/models/Enums";
import Service from "../src/models/Service";
import Trainer from "../src/models/Trainer";
import UnifiedBooking from "../src/models/UnifiedBooking";
import User from "../src/models/User";
import WorkoutPlanAssignment from "../src/models/WorkoutPlanAssignment";
import connectDB from "../src/utils/db";

async function seed() {
	await connectDB();
	const user = await User.findOne({ email: "whiskey@gmail.com" });
	if (!user) {
		console.error("Whiskey user not found!");
		process.exit(1);
	}

	const userId = user._id;
	console.log(`Seeding agenda items for Whiskey (${userId})...`);

	// 1. Seed or Update WorkoutPlanAssignment for Whiskey
	const today = new Date("2026-11-14T00:00:00.000Z");
	const tomorrow = new Date("2026-11-15T00:00:00.000Z");
	const monday = new Date("2026-11-16T00:00:00.000Z");

	await WorkoutPlanAssignment.deleteMany({ userId });

	await WorkoutPlanAssignment.create({
		userId,
		planId: new mongoose.Types.ObjectId(),
		trainerId: new mongoose.Types.ObjectId(),
		assignedBy: userId,
		version: 1,
		status: "active",
		startDate: new Date("2026-11-10T00:00:00.000Z"),
		userDays: [
			{
				dayNumber: 1,
				name: "Upper Body Hypertrophy",
				isRestDay: false,
				exercises: [
					{
						exerciseId: new mongoose.Types.ObjectId(),
						orderIndex: 0,
						section: "workout",
						targetSets: 4,
						targetReps: 10,
						targetWeightKg: 70,
						restSeconds: 90,
					},
					{
						exerciseId: new mongoose.Types.ObjectId(),
						orderIndex: 1,
						section: "workout",
						targetSets: 3,
						targetReps: 12,
						targetWeightKg: 24,
						restSeconds: 60,
					},
				],
			},
			{
				dayNumber: 2,
				name: "Rest & Active Recovery",
				isRestDay: true,
				exercises: [],
			},
			{
				dayNumber: 3,
				name: "Lower Body & Glutes",
				isRestDay: false,
				exercises: [
					{
						exerciseId: new mongoose.Types.ObjectId(),
						orderIndex: 0,
						section: "workout",
						targetSets: 4,
						targetReps: 8,
						targetWeightKg: 100,
						restSeconds: 120,
					},
				],
			},
		],
		dayProgress: [
			{
				dayNumber: 1,
				scheduledDate: today,
				status: "pending",
			},
			{
				dayNumber: 2,
				scheduledDate: tomorrow,
				status: "pending",
			},
			{
				dayNumber: 3,
				scheduledDate: monday,
				status: "pending",
			},
		],
	});
	console.log("Seeded WorkoutPlanAssignment.");

	// 2. Seed Therapy Booking for Today (HBOT) & Tomorrow (Cryotherapy)
	const hbotService = await Service.findOne({ serviceName: /HBOT|Hyperbaric/i }) || (await Service.findOne({ serviceType: "Therapy" }));
	const cryoService = await Service.findOne({ serviceName: /Cryo/i }) || hbotService;

	// Clean up test bookings for today/tomorrow
	await Bookings.deleteMany({
		user: userId,
		bookingDate: { $gte: new Date("2026-11-14T00:00:00.000Z"), $lte: new Date("2026-11-16T23:59:59.999Z") },
	});

	if (hbotService) {
		await Bookings.create({
			user: userId,
			service: hbotService._id,
			bookingDate: today,
			startTime: "11:30",
			endTime: "12:15",
			status: BookingStatus.Confirmed,
			creditCostSnapshot: 1,
		});
		console.log(`Seeded Therapy booking: ${hbotService.serviceName} for today 11:30 AM`);
	}

	if (cryoService) {
		await Bookings.create({
			user: userId,
			service: cryoService._id,
			bookingDate: tomorrow,
			startTime: "10:00",
			endTime: "10:30",
			status: BookingStatus.Confirmed,
			creditCostSnapshot: 1,
		});
		console.log(`Seeded Therapy booking: ${cryoService.serviceName} for tomorrow 10:00 AM`);
	}

	// 3. Seed 1-on-1 PT Coaching with Coach Alex
	await UnifiedBooking.deleteMany({
		userId,
		bookingDate: { $gte: new Date("2026-11-14T00:00:00.000Z"), $lte: new Date("2026-11-16T23:59:59.999Z") },
	});

	await UnifiedBooking.create({
		userId,
		serviceCategory: ServiceCategory.EXPERT_SESSION,
		serviceSubtype: ServiceSubtype.TRAINER,
		assignedExpertName: "Coach Alex",
		bookingDate: today,
		startTime: "16:00",
		endTime: "16:45",
		appointmentMode: AppointmentMode.ONLINE,
		location: "Online Video Room",
		status: UnifiedBookingStatus.CONFIRMED,
		zegoRoomId: `session_pt_whiskey_${Date.now()}`,
		creditCostSnapshot: 1,
	});
	console.log("Seeded 1-on-1 Personal Training with Coach Alex for today 4:00 PM");

	console.log("\nAgenda seeding completed successfully!");
	process.exit(0);
}

seed().catch((err) => {
	console.error(err);
	process.exit(1);
});
