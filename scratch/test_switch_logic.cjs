const mongoose = require('mongoose');

const mongoUrl = "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function run() {
  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  const BookingSchema = new mongoose.Schema({}, { strict: false });
  const ExpertAppointment = mongoose.model('ExpertAppointment', BookingSchema, 'expertappointments');

  const userIdStr = '6a26abde8a2558551fa3fe36';
  const userId = new mongoose.Types.ObjectId(userIdStr);

  const appointment = await ExpertAppointment.findOne({
    userId,
    expertType: 'nutritionist',
    bookingStatus: {
      $in: ['Pending', 'Confirmed', 'Rescheduled']
    }
  });

  console.log("Found appointment:", appointment);

  await mongoose.disconnect();
}

run().catch(console.error);
