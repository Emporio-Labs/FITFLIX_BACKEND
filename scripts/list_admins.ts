import { config } from 'dotenv';
import mongoose from 'mongoose';
import Admin from '../src/models/Admin';
import connectDB from '../src/utils/db';
config();
await connectDB();
const admins = await Admin.find({});
console.log('Admins in fitflix_qa:', admins.map(a => ({ id: a._id, email: a.email, name: a.adminName })));
await mongoose.disconnect();
