import 'dotenv/config';
import mongoose from 'mongoose';
import { getPostAdmin } from '../src/services/community/moderation.service';

async function run() {
    await mongoose.connect(process.env.MONGODB_URL as string);
    const postId = '6a7203d37b59605225038ad5';
    try {
        const result = await getPostAdmin(postId);
        console.log(JSON.stringify(result?.media, null, 2));
    } catch (e) {
        console.error(e);
    }
    await mongoose.disconnect();
}
run();
