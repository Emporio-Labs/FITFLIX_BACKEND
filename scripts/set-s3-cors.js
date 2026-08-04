/**
 * One-time script to apply the required S3 CORS configuration so browsers
 * can PUT files directly to S3 using presigned URLs (video uploads).
 *
 * Run: node scripts/set-s3-cors.js
 *
 * The IAM user needs the s3:PutBucketCORS permission.
 * If you cannot grant that, apply the CORS rules manually in the AWS Console:
 *
 *   S3 Console → fitflix-storage bucket → Permissions tab → Cross-origin resource sharing (CORS)
 *
 * Paste the JSON shown at the bottom of this file.
 */

import 'dotenv/config';
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET || 'fitflix-storage';

const corsRules = [
  {
    AllowedOrigins: [
      'https://fitflix.in',
      'https://*.fitflix.in',
      'https://frontdesk.fitflix.in',
      'http://localhost:3000',
      'http://localhost:3001',
    ],
    AllowedMethods: ['PUT', 'GET'],
    AllowedHeaders: ['Content-Type', 'Content-Length', '*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

async function main() {
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: { CORSRules: corsRules },
      })
    );
    console.log('CORS rules applied to s3://' + BUCKET);
    console.log('Rules:', JSON.stringify(corsRules, null, 2));
  } catch (err) {
    console.error('Failed to set CORS:', err.name, err.message);
    console.error('\nApply this manually in the AWS Console (S3 -> bucket -> Permissions -> CORS):');
    console.log(JSON.stringify(corsRules, null, 2));
  }
}

main();
