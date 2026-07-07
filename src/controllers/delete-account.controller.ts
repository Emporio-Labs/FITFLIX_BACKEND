import type { RequestHandler } from "express";
import mongoose from "mongoose";
import DeletionRequest from "../models/DeletionRequest";
import User from "../models/User";
import { DeletionRequestStatus } from "../models/Enums";
import { deleteAndAnonymizeUserData } from "../utils/deletion-engine.service";
import {
	verifyFirebaseIdToken,
	FirebaseAuthError,
} from "../services/firebase-auth.service";
import {
	createDeletionRequestSchema,
	listDeletionRequestsQuerySchema,
	updateDeletionStatusSchema,
} from "../validators/delete-account.validator";

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
) => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const field = issue.path.length > 0 ? issue.path.join(".") : "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}
	return details;
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

/**
 * Serves a premium user-facing HTML page with a sleek dark glassmorphic UI.
 */
export const renderDeleteAccountPage: RequestHandler = (_req, res) => {
	const apiKey = process.env.FIREBASE_WEB_API_KEY || "";
	const projectId = process.env.FIREBASE_PROJECT_ID || "fitflix-new";
	const authDomain = process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
	const isDev = process.env.NODE_ENV !== "production";

	if (!apiKey && !isDev) {
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Request Account Deletion | Fitflix</title>
    <!-- Premium Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #080B11;
            --card-bg: rgba(13, 18, 30, 0.65);
            --border-color: rgba(255, 255, 255, 0.08);
            --text-primary: #F3F4F6;
            --text-secondary: #9CA3AF;
            --accent-primary: #8B5CF6;
            --accent-secondary: #EC4899;
            --accent-gradient: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%);
            --error-color: #EF4444;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 24px;
            padding: 40px;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }
        .config-error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.25);
            color: var(--error-color);
            border-radius: 12px;
            padding: 16px;
            font-size: 15px;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="config-error">
            <strong>Service Unavailable</strong><br>
            Firebase Authentication API Key is not configured on this server. Please contact support.
        </div>
    </div>
</body>
</html>`;
		res.setHeader("Content-Type", "text/html");
		res.status(503).send(html);
		return;
	}

	const showMockAlert = !apiKey && isDev;

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Request Account Deletion | Fitflix</title>
    <!-- Premium Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #080B11;
            --card-bg: rgba(13, 18, 30, 0.65);
            --border-color: rgba(255, 255, 255, 0.08);
            --text-primary: #F3F4F6;
            --text-secondary: #9CA3AF;
            --accent-primary: #8B5CF6;
            --accent-secondary: #EC4899;
            --accent-gradient: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%);
            --error-color: #EF4444;
            --success-color: #10B981;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow-x: hidden;
            position: relative;
            padding: 24px;
        }

        /* Animated Glowing Orbs Background */
        .ambient-background {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1;
            overflow: hidden;
            pointer-events: none;
        }

        .orb {
            position: absolute;
            border-radius: 50%;
            filter: blur(140px);
            opacity: 0.15;
            animation: float 20s infinite alternate ease-in-out;
        }

        .orb-1 {
            width: 400px;
            height: 400px;
            background: var(--accent-primary);
            top: -100px;
            left: -100px;
        }

        .orb-2 {
            width: 500px;
            height: 500px;
            background: var(--accent-secondary);
            bottom: -150px;
            right: -100px;
            animation-delay: -5s;
        }

        @keyframes float {
            0% { transform: translate(0, 0) scale(1); }
            100% { transform: translate(40px, 30px) scale(1.15); }
        }

        /* Main Container & Card */
        .container {
            width: 100%;
            max-width: 540px;
            z-index: 10;
        }

        .logo-container {
            text-align: center;
            margin-bottom: 24px;
        }

        .logo {
            font-size: 32px;
            font-weight: 700;
            letter-spacing: -0.5px;
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 24px;
            padding: 40px;
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
            position: relative;
            overflow: hidden;
            transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: var(--accent-gradient);
            opacity: 0.8;
        }

        .card-header {
            margin-bottom: 32px;
        }

        .card-title {
            font-size: 26px;
            font-weight: 600;
            margin-bottom: 8px;
            letter-spacing: -0.3px;
        }

        .card-subtitle {
            color: var(--text-secondary);
            font-size: 15px;
            line-height: 1.5;
        }

        /* Form Controls */
        .form-group {
            margin-bottom: 24px;
            position: relative;
        }

        .form-label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 8px;
            color: var(--text-primary);
            letter-spacing: 0.2px;
        }

        .form-input {
            width: 100%;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 14px 16px;
            font-family: inherit;
            color: var(--text-primary);
            font-size: 15px;
            transition: all 0.3s ease;
        }

        .form-input:focus {
            outline: none;
            border-color: var(--accent-primary);
            background: rgba(255, 255, 255, 0.07);
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
        }

        .form-textarea {
            resize: none;
            height: 80px;
        }

        /* Verification input group */
        .otp-group {
            display: none;
            animation: fadeIn 0.4s ease forwards;
        }

        /* Checkbox Styling */
        .checkbox-container {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            cursor: pointer;
            margin-top: 12px;
            margin-bottom: 28px;
            user-select: none;
        }

        .checkbox-input {
            display: none;
        }

        .checkbox-custom {
            width: 20px;
            height: 20px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.04);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: all 0.2s ease;
            margin-top: 2px;
        }

        .checkbox-container:hover .checkbox-custom {
            border-color: var(--accent-primary);
        }

        .checkbox-input:checked + .checkbox-custom {
            background: var(--accent-gradient);
            border-color: transparent;
        }

        .checkbox-custom::after {
            content: '';
            width: 5px;
            height: 9px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg) scale(0);
            transition: transform 0.2s ease;
            margin-bottom: 2px;
        }

        .checkbox-input:checked + .checkbox-custom::after {
            transform: rotate(45deg) scale(1);
        }

        .checkbox-label {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.5;
        }

        .checkbox-label strong {
            color: var(--text-primary);
        }

        /* Error States */
        .error-message {
            color: var(--error-color);
            font-size: 13px;
            margin-top: 6px;
            display: none;
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .form-group.has-error .form-input {
            border-color: var(--error-color);
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
        }

        .form-group.has-error .error-message {
            display: block;
        }

        /* Submit Button */
        .submit-btn {
            width: 100%;
            background: var(--accent-gradient);
            color: white;
            border: none;
            border-radius: 12px;
            padding: 16px;
            font-family: inherit;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .submit-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(139, 92, 246, 0.3);
            filter: brightness(1.1);
        }

        .submit-btn:active {
            transform: translateY(0);
        }

        .submit-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
        }

        /* Spinner */
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 0.8s linear infinite;
            display: none;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Success State */
        .success-state {
            display: none;
            text-align: center;
            animation: scaleUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @keyframes scaleUp {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
        }

        .success-icon-container {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px auto;
            position: relative;
        }

        .success-checkmark {
            width: 24px;
            height: 14px;
            border-left: 3px solid var(--success-color);
            border-bottom: 3px solid var(--success-color);
            transform: rotate(-45deg) translate(2px, -2px);
        }

        .success-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 12px;
        }

        .success-desc {
            color: var(--text-secondary);
            font-size: 15px;
            line-height: 1.6;
            margin-bottom: 24px;
        }

        .status-alert {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 16px;
            margin-top: 16px;
            text-align: left;
            font-size: 14px;
            line-height: 1.5;
            color: var(--text-secondary);
        }

        .status-alert strong {
            color: var(--text-primary);
        }
    </style>
</head>
<body>
    <div class="ambient-background">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
    </div>

    <div class="container">
        <div class="logo-container">
            <span class="logo">FITFLIX</span>
        </div>

        <div class="card" id="form-card">
            ${
							showMockAlert
								? `
            <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); color: #F59E0B; border-radius: 12px; padding: 14px; font-size: 14px; margin-bottom: 24px; line-height: 1.5; text-align: center;">
                <strong>Development Mock Mode</strong><br>
                Firebase key not set. SMS sending is mocked. Use <strong>123456</strong> as the verification code.
            </div>`
								: ""
						}

            <!-- Request Form -->
            <form id="deletion-form">
                <div class="card-header">
                    <h1 class="card-title">Delete Account & Data</h1>
                    <p class="card-subtitle">Request permanent deletion of your account. For security, we require SMS verification to verify account ownership.</p>
                </div>

                <!-- Step 1: Phone Input -->
                <div class="form-group" id="group-phone">
                    <label class="form-label" for="phone">Phone Number</label>
                    <input class="form-input" type="tel" id="phone" name="phone" placeholder="+919876543210" required>
                    <span style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; display: block;">Must include country code (e.g., +91 for India).</span>
                    <div class="error-message" id="phone-error">Please enter a valid phone number</div>
                </div>

                <!-- Step-2: OTP Input (Hidden initially) -->
                <div class="otp-group" id="otp-section">
                    <div class="form-group" id="group-otp">
                        <label class="form-label" for="otp">Verification Code (SMS)</label>
                        <input class="form-input" type="text" id="otp" name="otp" placeholder="Enter 6-digit code" autocomplete="one-time-code">
                        <div class="error-message" id="otp-error">Please enter the 6-digit verification code</div>
                    </div>

                    <div class="form-group" id="group-reason">
                        <label class="form-label" for="reason">Reason for Deletion (Optional)</label>
                        <textarea class="form-input form-textarea" id="reason" name="reason" placeholder="Let us know why you are requesting deletion..."></textarea>
                    </div>

                    <div class="form-group" id="group-confirm">
                        <label class="checkbox-container">
                            <input class="checkbox-input" type="checkbox" id="confirm" name="confirm" value="true">
                            <span class="checkbox-custom"></span>
                            <span class="checkbox-label">
                                I confirm that I want to request deletion of my account and associated data. I understand this action is <strong>permanent</strong> and <strong>irreversible</strong>.
                            </span>
                        </label>
                        <div class="error-message" id="confirm-error">You must confirm this request before submitting</div>
                    </div>
                </div>

                <!-- Invisible Recaptcha -->
                <div id="recaptcha-container"></div>

                <button class="submit-btn" type="submit" id="submit-btn">
                    <span id="btn-text">Send Verification Code</span>
                    <span class="spinner" id="btn-spinner"></span>
                </button>
            </form>

            <!-- Success Screen -->
            <div class="success-state" id="success-screen">
                <div class="success-icon-container">
                    <div class="success-checkmark"></div>
                </div>
                <h2 class="success-title">Request Submitted</h2>
                <p class="success-desc">We have successfully verified your phone number and logged your account deletion request.</p>
                
                <div class="status-alert">
                    <strong>What happens next?</strong><br>
                    1. Highly sensitive personal records (health markers, goals, consents, medical reports) will be deleted.<br>
                    2. Your profile details will be anonymized, and compliance/accounting history will be secured.<br>
                    3. Processing will complete within <strong>7 business days</strong>.
                </div>
            </div>
        </div>
    </div>

    <!-- Firebase Compat SDKs -->
    ${
			apiKey
				? `
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
    `
				: ""
		}
    
    <script>
        const isMockMode = ${!apiKey};
        let auth = null;

        if (!isMockMode) {
            // Initialize Firebase
            const firebaseConfig = {
                apiKey: "${apiKey}",
                authDomain: "${authDomain}",
                projectId: "${projectId}"
            };
            firebase.initializeApp(firebaseConfig);
            auth = firebase.auth();
            auth.useDeviceLanguage();

            // Setup Recaptcha
            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                'size': 'invisible',
                'callback': (response) => {
                    // recaptcha solved
                }
            }, auth);
        }

        const form = document.getElementById('deletion-form');
        const successScreen = document.getElementById('success-screen');
        const submitBtn = document.getElementById('submit-btn');
        const btnText = document.getElementById('btn-text');
        const btnSpinner = document.getElementById('btn-spinner');
        const otpSection = document.getElementById('otp-section');
        const phoneInput = document.getElementById('phone');
        const otpInput = document.getElementById('otp');
        const confirmInput = document.getElementById('confirm');

        let verificationId = null;
        let smsSent = false;

        // Clean error states on input change
        ['phone', 'otp', 'confirm'].forEach(id => {
            const inputEl = document.getElementById(id);
            if (inputEl) {
                inputEl.addEventListener('input', () => {
                    document.getElementById('group-' + id).classList.remove('has-error');
                });
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Clean previous errors
            document.getElementById('group-phone').classList.remove('has-error');
            if (smsSent) {
                document.getElementById('group-otp').classList.remove('has-error');
                document.getElementById('group-confirm').classList.remove('has-error');
            }

            const phone = phoneInput.value.trim();

            if (!smsSent) {
                // Step 1: Send SMS OTP
                if (!phone.startsWith('+')) {
                    document.getElementById('group-phone').classList.add('has-error');
                    document.getElementById('phone-error').textContent = "Phone number must include country code prefix (e.g., +91).";
                    return;
                }

                // Loading state
                submitBtn.disabled = true;
                btnText.style.display = 'none';
                btnSpinner.style.display = 'block';

                if (isMockMode) {
                    setTimeout(() => {
                        smsSent = true;
                        phoneInput.disabled = true;
                        otpSection.style.display = 'block';
                        btnText.textContent = 'Verify Code & Request Deletion';
                        
                        submitBtn.disabled = false;
                        btnText.style.display = 'block';
                        btnSpinner.style.display = 'none';
                    }, 800);
                    return;
                }

                try {
                    const confirmationResult = await auth.signInWithPhoneNumber(phone, window.recaptchaVerifier);
                    window.confirmationResult = confirmationResult;
                    
                    // Show OTP section and transition button
                    smsSent = true;
                    phoneInput.disabled = true;
                    otpSection.style.display = 'block';
                    btnText.textContent = 'Verify Code & Request Deletion';
                } catch (err) {
                    console.error("SMS send error:", err);
                    document.getElementById('group-phone').classList.add('has-error');
                    document.getElementById('phone-error').textContent = err.message || "Failed to send verification SMS. Please verify your phone number format.";
                    // Reset recaptcha verifier
                    window.recaptchaVerifier.render().then(function(widgetId) {
                        grecaptcha.reset(widgetId);
                    });
                } finally {
                    submitBtn.disabled = false;
                    btnText.style.display = 'block';
                    btnSpinner.style.display = 'none';
                }
            } else {
                // Step 2: Confirm OTP & Request Deletion
                const otp = otpInput.value.trim();
                const reason = document.getElementById('reason').value.trim();
                const confirm = confirmInput.checked;

                let hasError = false;

                if (!otp || otp.length < 6) {
                    document.getElementById('group-otp').classList.add('has-error');
                    hasError = true;
                }

                if (!confirm) {
                    document.getElementById('group-confirm').classList.add('has-error');
                    hasError = true;
                }

                if (hasError) return;

                // Loading state
                submitBtn.disabled = true;
                btnText.style.display = 'none';
                btnSpinner.style.display = 'block';

                try {
                    let firebaseIdToken = '';
                    if (isMockMode) {
                        if (otp !== '123456') {
                            throw new Error("Invalid verification code. Please check the code and try again.");
                        }
                        firebaseIdToken = 'mock-token-' + phone;
                    } else {
                        // Confirm OTP code with Firebase
                        const userCredential = await window.confirmationResult.confirm(otp);
                        firebaseIdToken = await userCredential.user.getIdToken();
                    }

                    // Send ID Token to backend to complete request
                    const response = await fetch('/delete-account/request', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ firebaseIdToken, reason, confirm })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        // Success transition
                        form.style.display = 'none';
                        successScreen.style.display = 'block';
                    } else {
                        if (data.code === 'NOT_FOUND') {
                            alert(data.error || 'No matching user profile was found in our system.');
                        } else {
                            alert(data.error || 'Failed to request deletion. Please try again.');
                        }
                    }
                } catch (err) {
                    console.error("Verification error:", err);
                    document.getElementById('group-otp').classList.add('has-error');
                    document.getElementById('otp-error').textContent = err.message || "Invalid verification code. Please check the code and try again.";
                } finally {
                    submitBtn.disabled = false;
                    btnText.style.display = 'block';
                    btnSpinner.style.display = 'none';
                }
            }
        });
    </script>
</body>
</html>`;

	res.setHeader("Content-Type", "text/html");
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://www.google.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://www.gstatic.com; connect-src 'self' https://www.gstatic.com https://www.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com https://*.googleapis.com; frame-src 'self' https://*.firebaseapp.com https://*.googleapis.com https://www.google.com;",
	);
	res.status(200).send(html);
};

/**
 * Public endpoint to submit a deletion request.
 */
export const createDeletionRequest: RequestHandler = async (req, res, next) => {
	const parsed = createDeletionRequestSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { firebaseIdToken, reason } = parsed.data;

	try {
		const identity = await verifyFirebaseIdToken(firebaseIdToken);
		const { firebaseUid, phoneNumber } = identity;

		const last10 = phoneNumber.replace(/\D/g, "").slice(-10);

		// Find the User document matching firebaseUid or phone
		const user = await User.findOne({
			$or: [
				{ firebaseUid },
				{ phone: { $regex: new RegExp(last10 + "$") } },
			],
		});

		if (!user) {
			res.status(404).json({
				error: "No active account found matching the verified phone number.",
				code: "NOT_FOUND",
			});
			return;
		}

		const deletionRequest = await DeletionRequest.create({
			userId: user._id,
			fullName: user.username,
			email: user.email || undefined,
			phone: phoneNumber,
			reason,
			status: DeletionRequestStatus.Pending,
			ipAddress: req.ip || "",
			userAgent: req.header("user-agent") || "",
		});

		console.log(
			"[POST /delete-account/request] Account deletion request created for verified user:",
			{
				requestId: deletionRequest._id,
				userId: user._id,
				phone: phoneNumber,
			},
		);

		res.status(201).json({
			message: "Account deletion request logged successfully",
			id: deletionRequest._id,
		});
	} catch (error) {
		if (error instanceof FirebaseAuthError) {
			const status = error.code === "FIREBASE_NOT_CONFIGURED" ? 503 : 401;
			res.status(status).json({
				error: error.message,
				code: error.code,
			});
			return;
		}
		console.error(
			"[POST /delete-account/request] Exception creating deletion request:",
			error,
		);
		next(error);
	}
};

/**
 * Admin endpoint: List deletion requests.
 */
export const getDeletionRequests: RequestHandler = async (req, res, next) => {
	const parsed = listDeletionRequestsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { page, limit, status } = parsed.data;

	try {
		const filter: Record<string, unknown> = {};
		if (status) {
			filter.status = status;
		}

		const [requests, total] = await Promise.all([
			DeletionRequest.find(filter)
				.populate("userId", "username email phone onboarded")
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit),
			DeletionRequest.countDocuments(filter),
		]);

		res.status(200).json({
			requests,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * Admin endpoint: Process or cancel a deletion request.
 */
export const updateDeletionRequestStatus: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid request id" },
		});
		return;
	}

	const parsed = updateDeletionStatusSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { status } = parsed.data;

	try {
		const deletionRequest = await DeletionRequest.findById(id);
		if (!deletionRequest) {
			res.status(404).json({
				error: "Deletion request not found",
				code: "NOT_FOUND",
			});
			return;
		}

		if (deletionRequest.status === DeletionRequestStatus.Processed) {
			res.status(409).json({
				error: "This deletion request has already been processed",
				code: "CONFLICT",
			});
			return;
		}

		if (status === DeletionRequestStatus.Processed) {
			// Resolve user to delete/anonymize
			let targetUserId: mongoose.Types.ObjectId | null = null;

			if (deletionRequest.userId) {
				targetUserId = deletionRequest.userId as mongoose.Types.ObjectId;
			} else {
				// Re-attempt look up user by email or phone in case they signed up/updated since requesting
				if (deletionRequest.email) {
					const userByEmail = await User.findOne({
						email: deletionRequest.email.trim(),
					}).select("_id");
					if (userByEmail) {
						targetUserId = userByEmail._id as mongoose.Types.ObjectId;
					}
				}

				if (!targetUserId && deletionRequest.phone) {
					const cleanedPhone = deletionRequest.phone.replace(/\D/g, "");
					const last10 = cleanedPhone.slice(-10);
					if (last10.length >= 8) {
						const userByPhone = await User.findOne({
							phone: { $regex: new RegExp(last10 + "$") },
						}).select("_id");
						if (userByPhone) {
							targetUserId = userByPhone._id as mongoose.Types.ObjectId;
						}
					}
				}
			}

			if (targetUserId) {
				// Execute deletion engine
				await deleteAndAnonymizeUserData(targetUserId);

				// Bind/update userId to preserve reference audit trail
				deletionRequest.userId = targetUserId;
			} else {
				console.warn(
					`[ADMIN_DELETION] No active user matching email: ${deletionRequest.email} or phone: ${deletionRequest.phone} was found. Request marked as processed without database modifications.`,
				);
			}
		}

		deletionRequest.status = status as DeletionRequestStatus;
		await deletionRequest.save();

		res.status(200).json({
			message: `Deletion request successfully updated to: ${status}`,
			request: deletionRequest,
		});
	} catch (error) {
		console.error(
			`[ADMIN_DELETION] Exception updating deletion request status to ${status}:`,
			error,
		);
		next(error);
	}
};
