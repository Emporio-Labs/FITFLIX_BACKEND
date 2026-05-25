import multer from "multer";

const ALLOWED_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
];

export const uploadMiddleware = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
			cb(null, true);
			return;
		}

		cb(new Error(`Unsupported file type: ${file.mimetype}`));
	},
});
