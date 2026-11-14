import axios from "axios";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("🚀 Uploading REAL media files to S3 for active chat conversation...");

  // 1. Authenticate as Trainer
  const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
    email: "ravi@chat.test",
    password: "chat-demo-1234",
  });
  const token = loginRes.data.accessToken || loginRes.data.token;
  const headers = { Authorization: `Bearer ${token}` };

  // 2. Get active conversation
  const convsRes = await axios.get(`${BASE_URL}/chat/conversations`, { headers });
  const conversations = convsRes.data.conversations;
  if (!conversations || conversations.length === 0) {
    throw new Error("No conversation found for Ravi Coach");
  }
  const conversationId = conversations[0].id;
  console.log(`Using conversation: ${conversationId}`);

  // 3. Upload REAL image file to S3
  const imagePath = "C:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/assets/images/fitflix_full_logo.png";
  if (fs.existsSync(imagePath)) {
    console.log("\n1. Presigning and uploading REAL image to AWS S3...");
    const imageBytes = fs.readFileSync(imagePath);
    const presignRes = await axios.post(
      `${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
      {
        fileName: "fitflix_full_logo.png",
        mimeType: "image/png",
        byteSize: imageBytes.length,
        kind: "image",
      },
      { headers }
    );

    const { uploadUrl, downloadUrl, url, s3Key } = presignRes.data;
    const finalDownloadUrl = downloadUrl || url;

    // Actually PUT the image bytes to AWS S3!
    const putRes = await axios.put(uploadUrl, imageBytes, {
      headers: { "Content-Type": "image/png" },
    });
    console.log(`   ✅ S3 PUT status: ${putRes.status} ${putRes.statusText}`);

    // Send chat message pointing to the newly uploaded S3 object
    const sendRes = await axios.post(
      `${BASE_URL}/chat/conversations/${conversationId}/messages`,
      {
        body: "Here is your verified nutrition guide & training plan!",
        clientMessageId: `real-img-${Date.now()}`,
        kind: "image",
        media: {
          s3Key,
          url: finalDownloadUrl,
          mimeType: "image/png",
          byteSize: imageBytes.length,
        },
      },
      { headers }
    );
    console.log("   ✅ Real photo message sent successfully to thread!");
  }

  // 4. Upload REAL audio file to S3
  const audioPath = "C:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/assets/sounds/workout_complete.wav";
  if (fs.existsSync(audioPath)) {
    console.log("\n2. Presigning and uploading REAL audio to AWS S3...");
    const audioBytes = fs.readFileSync(audioPath);
    const presignAudioRes = await axios.post(
      `${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
      {
        fileName: "workout_complete.wav",
        mimeType: "audio/wav",
        byteSize: audioBytes.length,
        kind: "audio",
      },
      { headers }
    );

    const { uploadUrl, downloadUrl, url, s3Key } = presignAudioRes.data;
    const finalDownloadUrl = downloadUrl || url;

    // Actually PUT the audio bytes to AWS S3!
    const putAudioRes = await axios.put(uploadUrl, audioBytes, {
      headers: { "Content-Type": "audio/wav" },
    });
    console.log(`   ✅ S3 PUT status: ${putAudioRes.status} ${putAudioRes.statusText}`);

    // Send voice memo message pointing to the newly uploaded S3 audio
    await axios.post(
      `${BASE_URL}/chat/conversations/${conversationId}/messages`,
      {
        body: "",
        clientMessageId: `real-audio-${Date.now()}`,
        kind: "audio",
        media: {
          s3Key,
          url: finalDownloadUrl,
          mimeType: "audio/wav",
          byteSize: audioBytes.length,
          durationSeconds: 4.5,
        },
      },
      { headers }
    );
    console.log("   ✅ Real voice memo message sent successfully to thread!");
  }

  console.log("\n🎉 ALL REAL MEDIA UPLOADS TO S3 COMPLETED SUCCESSFULLY!");
}

main().catch((err) => {
  console.error("❌ Error seeding real media:", err.response?.data || err.message);
  process.exit(1);
});
