import mongoose from 'mongoose';

const MONGODB_URL = "mongodb://localhost:27017/fitflix";

async function run() {
  await mongoose.connect(MONGODB_URL);
  console.log("Connected to local MongoDB");

  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  console.log(`Found ${users.length} users in DB.`);
  
  const userIds = users.map(u => String(u._id));
  const uniqueUserIds = new Set(userIds);
  console.log(`Unique user IDs count: ${uniqueUserIds.size}`);
  
  if (userIds.length !== uniqueUserIds.size) {
    console.warn("WARNING: Duplicate user IDs found!");
    const counts = {};
    for (const id of userIds) {
      counts[id] = (counts[id] || 0) + 1;
    }
    for (const [id, count] of Object.entries(counts)) {
      if (count > 1) {
        console.warn(`Duplicate ID: ${id} (occurs ${count} times)`);
      }
    }
  }

  const admins = await mongoose.connection.db.collection('admins').find({}).toArray();
  console.log(`Found ${admins.length} admins in DB.`);
  
  const adminIds = admins.map(a => String(a._id));
  const uniqueAdminIds = new Set(adminIds);
  console.log(`Unique admin IDs count: ${uniqueAdminIds.size}`);

  if (adminIds.length !== uniqueAdminIds.size) {
    console.warn("WARNING: Duplicate admin IDs found!");
  }

  await mongoose.disconnect();
}

run().catch(console.error);
