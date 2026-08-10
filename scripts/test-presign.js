// Test signed GET URL for a specific video key
import 'dotenv/config';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const BUCKET = process.env.AWS_S3_BUCKET || 'fitflix-storage';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Look for the video from the post ID in the screenshot
// The video key would be community/posts/videos/<uuid>.mp4
// Let's test with a known working video key if provided, otherwise use the one 
// from the test we did earlier (which we deleted), so let's check HEAD of any recent key

// First, try to HEAD an object to confirm the key exists
// Use the key pattern from the post in the screenshot
// Post ID from URL: 6a7203d37b59605225038ad5

// Since we can't list, generate a signed URL and test the fetch
// We'll use a placeholder - user should replace with actual key from DB

// Generate a test signed GET URL and check what headers S3 returns
// using the test object key we know about
const KEY = process.argv[2] || 'community/posts/videos/test-check.mp4';

console.log('Testing key:', KEY);

// 1. HEAD the object
try {
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }));
  console.log('HEAD result:');
  console.log('  ContentType:', head.ContentType);
  console.log('  ContentLength:', head.ContentLength);
} catch (e) {
  console.log('HEAD failed:', e.name, e.message);
  console.log('(Video may not be at this key — provide key as argument)');
}

// 2. Generate signed GET URL (exactly mirrors generateSignedUrl in backend)
const cmd = new GetObjectCommand({
  Bucket: BUCKET,
  Key: KEY,
  ResponseContentDisposition: 'inline',
  ResponseContentType: 'video/mp4',
});
const signedUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });

console.log('\nSigned GET URL signed headers:', new URL(signedUrl).searchParams.get('X-Amz-SignedHeaders'));

// 3. Simulate browser range fetch (this is what the <video> tag does)
console.log('\nSimulating browser Range request (Origin: http://localhost:3001)...');
const res = await fetch(signedUrl, {
  headers: {
    'Range': 'bytes=0-1023',
    'Origin': 'http://localhost:3001',
  }
});

console.log('Status:', res.status, res.statusText);
console.log('Content-Type:', res.headers.get('content-type'));
console.log('Content-Range:', res.headers.get('content-range'));
console.log('Accept-Ranges:', res.headers.get('accept-ranges'));
console.log('Access-Control-Allow-Origin:', res.headers.get('access-control-allow-origin'));
console.log('Access-Control-Expose-Headers:', res.headers.get('access-control-expose-headers'));

if (!res.headers.get('access-control-allow-origin')) {
  console.log('\n❌ CORS IS BLOCKING VIDEO PLAYBACK!');
  console.log('   S3 is not returning Access-Control-Allow-Origin for GET requests.');
  console.log('   The CORS config on the bucket may not include GET or localhost:3001.');
} else if (res.status === 200 || res.status === 206) {
  console.log('\n✅ Video fetch OK - CORS is working!');
  console.log('   Try opening this URL directly in browser to test playback:');
  console.log('  ', signedUrl);
} else {
  console.log('\n❌ Unexpected status:', res.status);
}
