import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Trainer from '../src/models/Trainer';

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fitflix';
  console.log('Connecting to Mongo:', mongoUri);
  await mongoose.connect(mongoUri);

  const trainers = await Trainer.find({}).select('+passwordHash');
  console.log(`Found ${trainers.length} trainers:`);
  for (const t of trainers) {
    console.log({
      id: t._id,
      name: t.trainerName,
      email: t.email,
      hasPasswordHash: Boolean(t.passwordHash),
      passwordHashPrefix: t.passwordHash ? t.passwordHash.slice(0, 15) : null,
      isActive: t.isActive,
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
