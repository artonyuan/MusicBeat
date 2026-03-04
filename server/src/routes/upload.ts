import express from 'express';
import { fileTypeFromFile } from 'file-type';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../../uploads');
const ALLOWED_AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg']);
const ALLOWED_UPLOAD_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp3',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
];

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, nanoid(10));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP3, WAV, and OGG are allowed.'));
    }
  },
});

export const uploadRouter = express.Router();

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code !== 'ENOENT') {
      console.warn('Failed to remove invalid upload:', error);
    }
  }
}

async function finalizeAudioUpload(file: Express.Multer.File): Promise<string> {
  const detectedFileType = await fileTypeFromFile(file.path);
  const detectedExt = detectedFileType?.ext?.toLowerCase();

  if (!detectedExt || !ALLOWED_AUDIO_EXTENSIONS.has(detectedExt)) {
    throw new Error('Invalid file content. Only MP3, WAV, and OGG are allowed.');
  }

  const finalFilename = `${file.filename}.${detectedExt}`;
  const finalPath = path.join(uploadsDir, finalFilename);
  await fs.promises.rename(file.path, finalPath);

  return finalFilename;
}

// Upload audio file
uploadRouter.post('/', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const finalFilename = await finalizeAudioUpload(req.file);
    const audioUrl = `/uploads/${finalFilename}`;

    res.json({
      success: true,
      filename: finalFilename,
      originalName: req.file.originalname,
      audioUrl,
      size: req.file.size,
    });
  } catch (error) {
    if (req.file) {
      await removeFileIfExists(req.file.path);
    }

    console.error('Upload error:', error);
    if (error instanceof Error && error.message === 'Invalid file content. Only MP3, WAV, and OGG are allowed.') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Upload failed' });
  }
});

// Error handler for multer
uploadRouter.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
  }
  res.status(400).json({ error: err.message });
});
