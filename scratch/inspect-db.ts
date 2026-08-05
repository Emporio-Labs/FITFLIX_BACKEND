import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URL = process.env.MONGODB_URL;
if (!MONGODB_URL) {
  console.error("MONGODB_URL is not set in environment");
  process.exit(1);
}

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URL);
    console.log("Connected successfully.\n");

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database instance is null");
    }

    console.log("=== LAST 5 NUTRITIONIST BOOKINGS ===");
    const bookings = await db
      .collection("nutritionistbookings")
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    if (bookings.length === 0) {
      console.log("No nutritionist bookings found.");
    } else {
      for (const booking of bookings) {
        // Fetch user info
        const user = await db
          .collection("users")
          .findOne({ _id: booking.userId });

        console.log(`Booking ID: ${booking._id}`);
        console.log(`User: ${user ? `${user.username} (${user.email || user.phone})` : "Unknown"}`);
        console.log(`User ID: ${booking.userId}`);
        console.log(`bookingDate: ${booking.bookingDate}`);
        console.log(`startTime: ${booking.startTime}`);
        console.log(`endTime: ${booking.endTime}`);
        console.log(`appointmentMode: ${booking.appointmentMode}`);
        console.log(`status: ${booking.status}`);
        console.log(`zegoRoomId: ${booking.zegoRoomId}`);
        console.log(`assignedNutritionistName: ${booking.assignedNutritionistName}`);
        console.log(`createdAt: ${booking.createdAt}`);
        console.log("------------------------------------------");
      }
    }

    // Let's also look up a user by email "rahul@fitflix.in" (seen in the user request image)
    console.log("\n=== USER INFO FOR rahul@fitflix.in ===");
    const rahul = await db
      .collection("users")
      .findOne({ email: "rahul@fitflix.in" });

    if (!rahul) {
      console.log("User rahul@fitflix.in not found.");
    } else {
      console.log(`User ID: ${rahul._id}`);
      console.log(`Username: ${rahul.username}`);
      console.log(`Phone: ${rahul.phone}`);
      console.log(`Onboarding completed: ${rahul.onboarded}`);
      console.log(`Onboarding Status:`, JSON.stringify(rahul.onboardingStatus, null, 2));

      // Fetch bookings for this user specifically
      const userBookings = await db
        .collection("nutritionistbookings")
        .find({ userId: rahul._id })
        .toArray();
      console.log(`\nBookings for Rahul (Total: ${userBookings.length}):`);
      for (const b of userBookings) {
        console.log(`  - Booking ID: ${b._id}, status: ${b.status}, date: ${b.bookingDate}, slot: ${b.startTime}-${b.endTime}, mode: ${b.appointmentMode}, nutritionist: ${b.assignedNutritionistName}`);
      }
    }

  } catch (error) {
    console.error("Error occurred:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

run();
