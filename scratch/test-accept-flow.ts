import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import NutritionistBooking from "../src/models/NutritionistBooking";
import connectDB from "../src/utils/db";

config();

async function main() {
	try {
		await connectDB();
		console.log("Connected to MongoDB.");

		// 1. Authenticate as Admin
		console.log("Logging in as admin...");
		const loginResponse = await fetch("http://localhost:3000/auth/login", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email: "admin-review@fitflix.in",
				password: "ReviewPass123!",
			}),
		});

		const loginData = await loginResponse.json() as any;
		const token = loginData?.accessToken;
		if (!token) {
			console.log("Login failed output:", loginData);
			throw new Error("Failed to get accessToken from login response");
		}
		console.log("Logged in successfully. Token obtained.");

		// 2. Accept booking for user Varma (ID: 6a2413599ae1cf5a74839621)
		const targetUserId = "6a2413599ae1cf5a74839621";
		console.log(`Sending accept request for user ID: ${targetUserId}...`);

		// We hit the accept endpoint with the user's ID
		const acceptResponse = await fetch(`http://localhost:3000/nutritionist/bookings/${targetUserId}/accept`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({}),
		});

		const acceptData = await acceptResponse.json();
		console.log("Response status:", acceptResponse.status);
		console.log("Response data:", JSON.stringify(acceptData, null, 2));

		// 3. Verify in Database
		console.log("\nVerifying database state...");
		const updatedUser = await User.findById(targetUserId);
		console.log("User current onboarding step:", updatedUser?.onboardingStatus?.currentStep);
		console.log("User nutritionistBooked status:", updatedUser?.onboardingStatus?.nutritionistBooked);

		const createdBooking = await NutritionistBooking.findOne({ user: targetUserId });
		console.log("\nNutritionist Booking details in DB:");
		if (createdBooking) {
			console.log("- Booking ID:", createdBooking._id);
			console.log("- Status:", createdBooking.bookingStatus);
			console.log("- Approval Status:", createdBooking.nutritionistApprovalStatus);
			console.log("- Meeting Link:", createdBooking.meetingLink);
			console.log("- Appointment Mode:", createdBooking.appointmentMode);
		} else {
			console.log("❌ No booking found in database for user!");
		}

	} catch (err: any) {
		console.error("❌ Test failed:", err.message);
	} finally {
		await mongoose.disconnect();
		console.log("Disconnected from MongoDB.");
	}
}

main();
