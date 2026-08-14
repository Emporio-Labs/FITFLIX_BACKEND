import app from './src/app';
import request from 'supertest';

async function run() {
    const res = await request(app).get('/gym-visits/currently-in');
    console.log('GET /gym-visits/currently-in ->', res.status, res.body);
    process.exit(0);
}
run();
