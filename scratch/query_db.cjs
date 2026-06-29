const mongoose = require('mongoose');

const mongoUrl = "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function run() {
  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  // Define minimal schemas
  const BookingSchema = new mongoose.Schema({}, { strict: false });
  const NutritionistBooking = mongoose.model('NutritionistBooking', BookingSchema, 'nutritionistbookings');
  const ExpertAppointment = mongoose.model('ExpertAppointment', BookingSchema, 'expertappointments');

  const nbList = await NutritionistBooking.find({}).sort({ createdAt: -1 }).limit(5).lean();
  console.log("\n--- NUTRITIONIST BOOKINGS ---");
  nbList.forEach(b => {
    console.log({
      _id: b._id,
      userId: b.user || b.userId,
      bookingStatus: b.bookingStatus,
      appointmentMode: b.appointmentMode,
      meetingLink: b.meetingLink,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime
    });
  });

  const eaList = await ExpertAppointment.find({ expertType: 'nutritionist' }).sort({ createdAt: -1 }).limit(5).lean();
  console.log("\n--- EXPERT APPOINTMENTS ---");
  eaList.forEach(b => {
    console.log({
      _id: b._id,
      userId: b.userId,
      bookingStatus: b.bookingStatus,
      meetingUrl: b.meetingUrl,
      meetingLink: b.meetingLink,
      appointmentStart: b.appointmentStart,
      appointmentEnd: b.appointmentEnd
    });
  });

  await mongoose.disconnect();
  console.log("\nDisconnected");
}

run().catch(console.error);
