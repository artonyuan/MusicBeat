import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import { requireAnonymousSessionForWrites } from './auth/anonymousSession.js';
import { uploadRouter } from './routes/upload.js';
import { beatmapRouter } from './routes/beatmap.js';
import { runRouter } from './routes/run.js';
import { sessionRouter } from './routes/session.js';
import { initDatabase } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;
const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const DEFAULT_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_READ_RATE_LIMIT_MAX = 120;
const DEFAULT_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_WRITE_RATE_LIMIT_MAX = 30;
const DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_UPLOAD_RATE_LIMIT_MAX = 10;
const DEFAULT_SESSION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_SESSION_RATE_LIMIT_MAX = 30;
const DEFAULT_TRUST_PROXY_HOPS = 1;

function parseCorsOrigins(rawOrigins: string | undefined): string[] {
  if (!rawOrigins) return DEFAULT_CORS_ORIGINS;

  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_CORS_ORIGINS;
}

function parsePositiveInteger(rawValue: string | undefined, fallbackValue: number): number {
  const parsedValue = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }

  return parsedValue;
}

function parseTrustProxy(rawValue: string | undefined): boolean | number {
  if (!rawValue || !rawValue.trim()) {
    return process.env.NODE_ENV === 'production' ? DEFAULT_TRUST_PROXY_HOPS : false;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === 'true') return true;
  if (normalizedValue === 'false') return false;

  const parsedHops = Number.parseInt(normalizedValue, 10);
  if (Number.isFinite(parsedHops) && parsedHops >= 0) {
    return parsedHops;
  }

  return process.env.NODE_ENV === 'production' ? DEFAULT_TRUST_PROXY_HOPS : false;
}

const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  optionsSuccessStatus: 204,
};

const corsErrorHandler: express.ErrorRequestHandler = (error, req, res, next) => {
  if (error.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'Origin not allowed by CORS policy' });
    return;
  }

  next(error);
};

const readRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.RATE_LIMIT_READ_WINDOW_MS, DEFAULT_READ_RATE_LIMIT_WINDOW_MS),
  max: parsePositiveInteger(process.env.RATE_LIMIT_READ_MAX, DEFAULT_READ_RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'GET',
  message: { error: 'Too many read requests. Please try again in a minute.' },
});

const writeRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.RATE_LIMIT_WRITE_WINDOW_MS, DEFAULT_WRITE_RATE_LIMIT_WINDOW_MS),
  max: parsePositiveInteger(process.env.RATE_LIMIT_WRITE_MAX, DEFAULT_WRITE_RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  message: { error: 'Too many write requests. Please try again in a minute.' },
});

const uploadRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS),
  max: parsePositiveInteger(process.env.RATE_LIMIT_UPLOAD_MAX, DEFAULT_UPLOAD_RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  message: { error: 'Too many upload attempts. Please try again in a minute.' },
});

const sessionRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.RATE_LIMIT_SESSION_WINDOW_MS, DEFAULT_SESSION_RATE_LIMIT_WINDOW_MS),
  max: parsePositiveInteger(process.env.RATE_LIMIT_SESSION_MAX, DEFAULT_SESSION_RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  message: { error: 'Too many session requests. Please try again in a minute.' },
});

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', trustProxy);
app.use(helmet({
  // Audio files are served from this API origin and consumed by the client origin.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Serve uploaded audio files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Initialize database
initDatabase();

// API Routes
app.use('/api/session', sessionRateLimiter, sessionRouter);
app.use('/api/upload', requireAnonymousSessionForWrites, uploadRateLimiter, uploadRouter);
app.use('/api/beatmap', readRateLimiter, requireAnonymousSessionForWrites, writeRateLimiter, beatmapRouter);
app.use('/api/run', readRateLimiter, requireAnonymousSessionForWrites, writeRateLimiter, runRouter);
app.use(corsErrorHandler);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Pong server running on http://localhost:${PORT}`);
});

export default app;
