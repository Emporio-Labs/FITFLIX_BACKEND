const mongoose = require('mongoose');

const mongoUrl = "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function run() {
  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  const BookingSchema = new mongoose.Schema({}, { strict: false });
  const ExpertAppointment = mongoose.model('ExpertAppointment', BookingSchema, 'expertappointments');

  const apptId = '6a26ae7ec24132d05edecc89';
  
  // Set date to tomorrow (June 9, 2026) at 8:00 PM (14:30 UTC)
  const tomorrowStart = new Date('2026-06-09T14:30:00.000Z');
  const tomorrowEnd = new Date('2026-06-09T15:00:00.000Z');

  const result = await ExpertAppointment.findByIdAndUpdate(apptId, {
    $set: {
      appointmentStart: tomorrowStart,
      appointmentEnd: tomorrowEnd,
      appointmentDate: tomorrowStart,
      appointmentMode: 'IN_PERSON'
    }
  }, { new: true });

  console.log("Updated appointment:", result);

  await mongoose.disconnect();
  console.log("Disconnected");
}

run().catch(console.error);
