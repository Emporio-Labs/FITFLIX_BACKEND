import mongoose from "mongoose";
import dotenv from "dotenv";
import { hashPassword } from "../src/utils/password";
import Trainer from "../src/models/Trainer";
import Post from "../src/models/Post";
import PostVersion from "../src/models/PostVersion";
import { CommunityRole, PostStatus, PostVisibility } from "../src/models/Enums";

dotenv.config();

async function main() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    console.error("MONGODB_URL not set");
    process.exit(1);
  }

  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  const email = "mashenmi@fitflix.in";
  let trainer = await Trainer.findOne({ email }).select("+passwordHash");

  if (!trainer) {
    console.error(`Trainer with email ${email} not found!`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Found trainer: ${trainer.trainerName} (${trainer._id})`);
  console.log(`Current avatar: ${trainer.imageUrl}`);

  // Hash new password
  const newPasswordHash = await hashPassword("Trainer@123");

  // Update trainer info
  trainer.trainerName = "Coach Mashenmi";
  trainer.passwordHash = newPasswordHash;
  trainer.keySentence = "Specializing in Functional Strength, High-Performance Conditioning & Mobility.";
  trainer.description =
    "Elite strength and conditioning coach with 7+ years of experience helping athletes and fitness enthusiasts achieve functional strength, optimal body composition, and injury-free movement mechanics. Certified in advanced biomechanics and athletic performance programming.";
  trainer.specialities = ["Strength Training", "HIIT", "Conditioning", "Mobility & Flexibility"];
  trainer.certifications = ["CSCS (NSCA)", "NASM-CPT", "CrossFit L1"];
  
  await trainer.save();
  console.log("Updated trainer profile successfully!");

  // Clean up any old test posts for this trainer
  const deleteResult = await Post.deleteMany({ authorId: trainer._id });
  console.log(`Deleted ${deleteResult.deletedCount} previous posts for trainer`);

  // Create 3 realistic posts
  const postsData = [
    {
      title: "3 Core Stability Exercises for Heavier Squats",
      content:
        "Most lifters fail squats not because their legs are weak, but because their core stability leaks power. Here are 3 non-negotiable accessory movements I program for my 1-on-1 clients:\n\n1. Heavy Suitcase Carries — builds anti-lateral flexion.\n2. Copenhagen Planks — fires the adductors & deep groin stabilizers.\n3. Deadbugs with isometric wall push — teaches pelvic control under load.\n\nAdd these to your warmup twice a week and notice how much tighter your walkout feels!",
      description: "Full accessory breakdown and tempo recommendations for strength athletes looking to break squat plateaus.",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      likeCount: 24,
      commentCount: 5,
      shareCount: 3,
    },
    {
      title: "Why Mobility Work is Non-Negotiable",
      content:
        "Flexibility is passive range of motion. Mobility is strength and control through that range.\n\nIf you can't reach depth in a goblet squat without your heels lifting or your lumbar rounding, no amount of heavy lifting will fix that pattern. Dedicate 10 minutes before every session to ankle dorsiflexion and thoracic extension drills. Movement quality always precedes load.",
      description: "Understanding passive vs active range of motion and joint longevity.",
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      likeCount: 38,
      commentCount: 8,
      shareCount: 6,
    },
    {
      title: "Pre-Workout Nutrition for Morning Sessions",
      content:
        "Training at 7:00 AM with me? Don't train completely fasted if your goal is progressive overload.\n\nHave a fast-digesting carb 30 minutes before: half a banana with a pinch of pink salt, or a slice of sourdough with a dab of honey. Your central nervous system will thank you when you hit your working sets.",
      description: "Optimizing glycogen stores and hydration for peak morning output.",
      createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
      likeCount: 42,
      commentCount: 11,
      shareCount: 4,
    },
  ];

  for (const p of postsData) {
    const post = new Post({
      authorId: trainer._id,
      authorRole: CommunityRole.Trainer,
      title: p.title,
      content: p.content,
      description: p.description,
      visibility: PostVisibility.Public,
      status: PostStatus.Published,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      shareCount: p.shareCount,
      repostCount: 0,
      createdAt: p.createdAt,
      updatedAt: p.createdAt,
    });
    await post.save();

    const version = new PostVersion({
      postId: post._id,
      editedBy: String(trainer._id),
      titleSnapshot: p.title,
      contentSnapshot: p.content,
      descriptionSnapshot: p.description,
      mediaSnapshot: [],
      createdAt: p.createdAt,
    });
    await version.save();

    console.log(`Created post: "${p.title}" (ID: ${post._id})`);
  }

  console.log("All posts created successfully!");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error running script:", err);
  process.exit(1);
});
