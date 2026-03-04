import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadRouter } from './routes/upload.js';
import { beatmapRouter } from './routes/beatmap.js';
import { runRouter } from './routes/run.js';
import { initDatabase } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve uploaded audio files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Initialize database
initDatabase();

// API Routes
app.use('/api/upload', uploadRouter);
app.use('/api/beatmap', beatmapRouter);
app.use('/api/run', runRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Pong server running on http://localhost:${PORT}`);
});

export default app;
