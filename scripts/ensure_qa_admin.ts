import { config } from 'dotenv';
import mongoose from 'mongoose';
import Admin from '../src/models/Admin';
import connectDB from '../src/utils/db';
import { hashPassword } from '../src/utils/password';
config();
await connectDB();
let admin = await Admin.findOne({ email: 'qa-admin@fitflix.in' });
const pwHash = await hashPassword('Admin@1234');
if (!admin) {
    admin = await Admin.create({
        adminName: 'QA FrontDesk Staff',
        email: 'qa-admin@fitflix.in',
        phone: '9999900010',
        passwordHash: pwHash
    });
    console.log('Created qa-admin@fitflix.in');
} else {
    admin.passwordHash = pwHash;
    await admin.save();
    console.log('Updated qa-admin@fitflix.in password to Admin@1234');
}
await mongoose.disconnect();
