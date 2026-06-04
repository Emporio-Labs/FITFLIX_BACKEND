import { config } from "dotenv";
import admin from "firebase-admin";

config();

const encoded = process.env.FCM_SERVICE_ACCOUNT_JSON;
if (!encoded) {
  console.error("❌ FCM_SERVICE_ACCOUNT_JSON is not set in .env");
  process.exit(1);
}

try {
  const serviceAccount = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf-8")
  );
  console.log("✅ Successfully decoded FCM_SERVICE_ACCOUNT_JSON");
  console.log("Project ID in Service Account:", serviceAccount.project_id);
  console.log("Client Email:", serviceAccount.client_email);
  
  // Try to initialize
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("✅ Firebase Admin successfully initialized with this credential");
} catch (e) {
  console.error("❌ Failed to parse or initialize Firebase Admin:", e);
}
