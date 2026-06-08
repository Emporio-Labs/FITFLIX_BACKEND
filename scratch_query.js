import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function run() {
  await mongoose.connect(MONGODB_URL);
  console.log("Connected to MongoDB");
  
  const bookings = await mongoose.connection.db.collection('bookings').find({}).toArray();
  console.log(`Found ${bookings.length} bookings.`);
  
  // print last 10 bookings
  const lastBookings = bookings.slice(-10);
  for (const b of lastBookings) {
    console.log({
      _id: b._id,
      bookingDate: b.bookingDate,
      bookingDateType: typeof b.bookingDate,
      bookingDateStr: b.bookingDate instanceof Date ? b.bookingDate.toISOString() : b.bookingDate,
      status: b.status,
      createdAt: b.createdAt
    });
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
