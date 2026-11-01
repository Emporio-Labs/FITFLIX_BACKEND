import mongoose from "mongoose";
import dotenv from "dotenv";
import Trainer from "../src/models/Trainer";
import Post from "../src/models/Post";
import PostMedia from "../src/models/PostMedia";
import PostVersion from "../src/models/PostVersion";
import { uploadToS3, generateSignedUrl } from "../src/utils/s3.service";
import { CommunityRole, PostMediaKind, PostStatus, PostVisibility } from "../src/models/Enums";

dotenv.config();

async function main() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    console.error("MONGODB_URL not set in .env");
    process.exit(1);
  }

  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  const email = "mashenmi@fitflix.in";
  const trainer = await Trainer.findOne({ email });

  if (!trainer) {
    console.error(`Trainer ${email} not found!`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found trainer: ${trainer.trainerName} (${trainer._id})`);

  // 1. Download and upload sample fitness photo
  console.log("\n[1/4] Downloading sample fitness photo...");
  const photoUrl =
    "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=1200&auto=format&fit=crop";
  const photoRes = await fetch(photoUrl);
  const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
  const photoKey = "community/posts/mashenmi-photo-rdl.jpg";
  console.log(`Uploading photo to S3 (${photoBuffer.length} bytes)...`);
  await uploadToS3(photoKey, photoBuffer, "image/jpeg");
  console.log(`Photo uploaded to S3 at: ${photoKey}`);

  // 2. Download and upload sample video
  console.log("\n[2/4] Downloading sample fitness drill video...");
  const videoUrl = "https://www.w3schools.com/html/mov_bbb.mp4";
  const videoRes = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const videoKey = "community/posts/mashenmi-video-flow.mp4";
  console.log(`Uploading video to S3 (${videoBuffer.length} bytes)...`);
  await uploadToS3(videoKey, videoBuffer, "video/mp4");
  console.log(`Video uploaded to S3 at: ${videoKey}`);

  // 3. Create Photo Post
  console.log("\n[3/4] Creating Photo Post in database...");
  const photoPost = new Post({
    authorId: trainer._id,
    authorRole: CommunityRole.Trainer,
    title: "Technique Focus: The Romanian Deadlift (RDL)",
    content:
      "Mastering the hip hinge is the single best investment you can make for hamstring development and lower back durability. Notice the slight knee bend, flat spine, and hips driving backward into the wall rather than squatting down.\n\nKeep the bar shaved against your shins the entire descent. If you feel it in your lower back, you're losing lat tension or reaching too low.",
    description: "In-depth biomechanical breakdown of the RDL setup, bar path, and foot pressure.",
    visibility: PostVisibility.Public,
    status: PostStatus.Published,
    likeCount: 52,
    commentCount: 14,
    shareCount: 8,
    repostCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await photoPost.save();

  await PostMedia.create({
    postId: photoPost._id,
    kind: PostMediaKind.Image,
    url: photoKey,
    position: 0,
    width: 1200,
    height: 800,
  });

  await PostVersion.create({
    postId: photoPost._id,
    editedBy: String(trainer._id),
    titleSnapshot: photoPost.title,
    contentSnapshot: photoPost.content,
    descriptionSnapshot: photoPost.description,
    mediaSnapshot: [{ kind: PostMediaKind.Image, url: photoKey, width: 1200, height: 800 }],
  });

  const photoSignedUrl = await generateSignedUrl(photoKey, 900, "image/jpeg");
  console.log(`Created Photo Post: "${photoPost.title}" (ID: ${photoPost._id})`);
  console.log(`Photo Signed URL: ${photoSignedUrl.substring(0, 80)}...`);

  // 4. Create Video Post
  console.log("\n[4/4] Creating Video Post in database...");
  const videoPost = new Post({
    authorId: trainer._id,
    authorRole: CommunityRole.Trainer,
    title: "Movement Analysis: 3-Minute Pre-Squat Mobility Flow",
    content:
      "Here is a quick mobility flow every athlete should run through before hitting heavy squats or deadlifts. Opens the hips, activates the glute medius, and primes the nervous system for maximal force production.\n\nWatch the full breakdown and save this drill for your next session!",
    description: "Follow-along 3-minute dynamic warmup flow to prepare hips, ankles, and spine for heavy squats.",
    visibility: PostVisibility.Public,
    status: PostStatus.Published,
    likeCount: 78,
    commentCount: 21,
    shareCount: 15,
    repostCount: 0,
    createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
    updatedAt: new Date(Date.now() - 30 * 60 * 1000),
  });
  await videoPost.save();

  await PostMedia.create({
    postId: videoPost._id,
    kind: PostMediaKind.Video,
    url: videoKey,
    position: 0,
    duration: 10,
  });

  await PostVersion.create({
    postId: videoPost._id,
    editedBy: String(trainer._id),
    titleSnapshot: videoPost.title,
    contentSnapshot: videoPost.content,
    descriptionSnapshot: videoPost.description,
    mediaSnapshot: [{ kind: PostMediaKind.Video, url: videoKey, duration: 10 }],
  });

  const videoSignedUrl = await generateSignedUrl(videoKey, 900, "video/mp4");
  console.log(`Created Video Post: "${videoPost.title}" (ID: ${videoPost._id})`);
  console.log(`Video Signed URL: ${videoSignedUrl.substring(0, 80)}...`);

  console.log("\n Successfully uploaded and created both Photo and Video posts for Coach Mashenmi!");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error in upload-trainer-posts:", err);
  process.exit(1);
});
