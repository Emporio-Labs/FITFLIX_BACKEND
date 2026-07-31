import crypto from "node:crypto";

enum ErrorCode {
	success = 0,
	appIDInvalid = 1,
	userIDInvalid = 3,
	secretInvalid = 5,
	effectiveTimeInSecondsInvalid = 6,
}

function RndNum(a: number, b: number): number {
	return Math.ceil((a + (b - a)) * Math.random());
}

// Function to generate random 16 character string
function makeRandomIv(): string {
	const str = "0123456789abcdefghijklmnopqrstuvwxyz";
	const result: string[] = [];
	for (let i = 0; i < 16; i++) {
		const r = Math.floor(Math.random() * str.length);
		result.push(str.charAt(r));
	}
	return result.join("");
}

// Function to determine algorithm based on length of secret key (16, 24 or 32 bytes)
function getAlgorithm(keyBase64: string): string {
	const key = Buffer.from(keyBase64);
	switch (key.length) {
		case 16:
			return "aes-128-cbc";
		case 24:
			return "aes-192-cbc";
		case 32:
			return "aes-256-cbc";
	}
	throw new Error(`Invalid key length: ${key.length}`);
}

// AES encryption function using CBC/PKCS5Padding mode
function aesEncrypt(plainText: string, key: string, iv: string): ArrayBuffer {
	const cipher = crypto.createCipheriv(getAlgorithm(key), Buffer.from(key), Buffer.from(iv));
	cipher.setAutoPadding(true);
	const encrypted = cipher.update(plainText, "utf8");
	const finalBuf = cipher.final();
	const out = Buffer.concat([encrypted, finalBuf]);
	return Uint8Array.from(out).buffer;
}

// Function to generate token using given parameters
export function generateToken04(
	appId: number,
	userId: string,
	secret: string,
	effectiveTimeInSeconds: number,
	payload?: string,
): string {
	if (!appId || typeof appId !== "number") {
		throw {
			errorCode: ErrorCode.appIDInvalid,
			errorMessage: "appID invalid",
		};
	}
	if (!userId || typeof userId !== "string") {
		throw {
			errorCode: ErrorCode.userIDInvalid,
			errorMessage: "userId invalid",
		};
	}
	if (!secret || typeof secret !== "string" || secret.length !== 32) {
		throw {
			errorCode: ErrorCode.secretInvalid,
			errorMessage: "secret must be a 32 byte string",
		};
	}
	if (!effectiveTimeInSeconds || typeof effectiveTimeInSeconds !== "number") {
		throw {
			errorCode: ErrorCode.effectiveTimeInSecondsInvalid,
			errorMessage: "effectiveTimeInSeconds invalid",
		};
	}

	const createTime = Math.floor(Date.now() / 1000); // Get current time in seconds
	const tokenInfo = {
		app_id: appId,
		user_id: userId,
		nonce: RndNum(-2147483648, 2147483647),
		ctime: createTime,
		expire: createTime + effectiveTimeInSeconds,
		payload: payload || "",
	};

	const plainText = JSON.stringify(tokenInfo);
	const iv = makeRandomIv();
	const encryptBuf = aesEncrypt(plainText, secret, iv);

	const b1 = new Uint8Array(8);
	const b2 = new Uint8Array(2);
	const b3 = new Uint8Array(2);

	new DataView(b1.buffer).setBigInt64(0, BigInt(tokenInfo.expire), false);
	new DataView(b2.buffer).setUint16(0, iv.length, false);
	new DataView(b3.buffer).setUint16(0, encryptBuf.byteLength, false);

	const buf = Buffer.concat([
		Buffer.from(b1),
		Buffer.from(b2),
		Buffer.from(iv, "utf8"),
		Buffer.from(b3),
		Buffer.from(encryptBuf),
	]);

	const dv = new DataView(Uint8Array.from(buf).buffer);
	return "04" + Buffer.from(dv.buffer).toString("base64");
}
