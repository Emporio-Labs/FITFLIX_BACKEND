import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import NutritionistBooking from "../src/models/NutritionistBooking";
import ExpertAppointment from "../src/models/ExpertAppointment";
import connectDB from "../src/utils/db";

config();

async function main() {
	try {
		await connectDB();
		console.log("Connected to MongoDB database.");

		const users = await User.find({}, "username email phone onboarded");
		console.log("\n=== USERS IN SYSTEM ===");
		for (const u of users) {
			console.log(
				`- ID: ${u._id} | User: ${u.username} | Email: ${u.email} | Phone: ${u.phone} | Onboarded: ${u.onboarded}`,
			);
		}

		const nutritionistBookings = await NutritionistBooking.find({});
		console.log("\n=== NUTRITIONIST BOOKINGS ===");
		if (nutritionistBookings.length === 0) {
			console.log("No nutritionist bookings found in NutritionistBooking collection.");
		}
		for (const nb of nutritionistBookings) {
			console.log(
				`- ID: ${nb._id} | UserID: ${nb.user} | Slot: ${nb.slot} | Date: ${nb.date} | Status: ${nb.bookingStatus}`,
			);
		}

		const expertAppointments = await ExpertAppointment.find({});
		console.log("\n=== EXPERT APPOINTMENTS ===");
		if (expertAppointments.length === 0) {
			console.log("No expert appointments found in ExpertAppointment collection.");
		}
		for (const ea of expertAppointments) {
			console.log(
				`- ID: ${ea._id} | UserID: ${ea.userId} | ExpertType: ${ea.expertType} | Status: ${ea.bookingStatus} | CalIdBookingId: ${ea.calIdBookingId} | Start: ${ea.appointmentStart}`,
			);
		}

	} catch (err) {
		console.error("Error inspecting database:", err);
	} finally {
		await mongoose.disconnect();
		console.log("Disconnected from MongoDB.");
	}
}

main();
