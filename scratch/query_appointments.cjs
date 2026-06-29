const mongoose = require('mongoose');

const mongoUrl = "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function run() {
  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  // Query expert appointments
  const ExpertAppointment = mongoose.model('ExpertAppointment', new mongoose.Schema({}, { strict: false }), 'expertappointments');
  const appointments = await ExpertAppointment.find({ expertType: 'nutritionist' }).lean();
  console.log("Nutritionist Expert Appointments Count:", appointments.length);
  for (const app of appointments) {
    console.log("Appointment:", {
      _id: app._id,
      userId: app.userId,
      expertType: app.expertType,
      bookingStatus: app.bookingStatus,
      appointmentStart: app.appointmentStart,
      appointmentMode: app.appointmentMode
    });
  }

  // Query nutritionist legacy bookings
  const NutritionistBooking = mongoose.model('NutritionistBooking', new mongoose.Schema({}, { strict: false }), 'nutritionistbookings');
  const bookings = await NutritionistBooking.find({}).lean();
  console.log("Nutritionist Bookings (Legacy) Count:", bookings.length);
  for (const b of bookings) {
    console.log("Legacy Booking:", {
      _id: b._id,
      user: b.user,
      bookingStatus: b.bookingStatus,
      date: b.date,
      startTime: b.startTime,
      appointmentMode: b.appointmentMode
    });
  }

  await mongoose.disconnect();
}

run().catch(console.error);
