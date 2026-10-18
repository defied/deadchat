import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED_MIMETYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'application/octet-stream',
  // Text / documents
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/pdf',
  // Code files
  'text/javascript',
  'text/typescript',
  'text/html',
  'text/css',
  'text/x-python',
  'application/json',
  'application/xml',
  'text/xml',
  'application/x-yaml',
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

// Browsers report inconsistent MIME types for source files (.ts → video/mp2t,
// .sh → application/x-sh, .yaml → ''), so also accept by extension.
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.heic', '.heif',
  '.txt', '.md', '.csv', '.pdf', '.json', '.yaml', '.yml', '.xml', '.html', '.css',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.sql', '.sh', '.rb', '.go', '.rs', '.java',
  '.cpp', '.c', '.h', '.toml', '.ini', '.log',
]);

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIMETYPES.includes(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize,
  },
});
