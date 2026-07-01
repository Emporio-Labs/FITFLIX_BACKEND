import mongoose from "mongoose";
import Booking from "./src/models/Bookings";
import connectDB from "./src/utils/db";

async function run() {
  await connectDB();
  const bookings = await Booking.find({});
  const b = bookings.find(b => b._id.toString().endsWith('af7261'));
  
  if (!b) {
    console.log("Not found");
    process.exit(1);
  }
  console.log("Found:", b._id.toString(), "Status:", b.status);
  
  try {
    b.status = "2"; // 2 = Cancelled
    await b.save();
    console.log("Saved successfully");
  } catch(err) {
    console.error("Save error:", err);
  }
  process.exit(0);
}

run();
