import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'pong.db');
const legacyDbPath = path.join(dataDir, 'musicbeat.db');

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    let resolvedDbPath = dbPath;
    if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
      try {
        fs.renameSync(legacyDbPath, dbPath);
        console.log('Migrated database file: musicbeat.db -> pong.db');
      } catch (error) {
        console.warn('Failed to migrate legacy database file, continuing with existing path.', error);
        resolvedDbPath = legacyDbPath;
      }
    }

    db = new Database(resolvedDbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initDatabase(): void {
  const database = getDatabase();

  // Create beatmaps table
  database.exec(`
    CREATE TABLE IF NOT EXISTS beatmaps (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      duration REAL NOT NULL,
      bpm INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      audio_filename TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      play_count INTEGER DEFAULT 0
    )
  `);

  // Create runs table (public, unlisted share pages)
  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      handle TEXT NOT NULL,
      score INTEGER NOT NULL,
      accuracy REAL NOT NULL,
      max_combo INTEGER NOT NULL,
      grade TEXT NOT NULL,
      perfect_count INTEGER NOT NULL,
      good_count INTEGER NOT NULL,
      ok_count INTEGER NOT NULL,
      miss_count INTEGER NOT NULL,
      bpm INTEGER NOT NULL,
      duration REAL NOT NULL,
      difficulty TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database initialized');
}

// Beatmap types for database
export interface BeatmapRecord {
  id: string;
  title: string;
  duration: number;
  bpm: number;
  difficulty: string;
  audio_filename: string;
  notes_json: string;
  created_at: string;
  play_count: number;
}

export interface RunRecord {
  id: string;
  title: string;
  handle: string;
  score: number;
  accuracy: number;
  max_combo: number;
  grade: string;
  perfect_count: number;
  good_count: number;
  ok_count: number;
  miss_count: number;
  bpm: number;
  duration: number;
  difficulty: string;
  created_at: string;
}

// CRUD operations
export function saveBeatmap(beatmap: Omit<BeatmapRecord, 'created_at' | 'play_count'>): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO beatmaps (id, title, duration, bpm, difficulty, audio_filename, notes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    beatmap.id,
    beatmap.title,
    beatmap.duration,
    beatmap.bpm,
    beatmap.difficulty,
    beatmap.audio_filename,
    beatmap.notes_json
  );
}

export function getBeatmap(id: string): BeatmapRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM beatmaps WHERE id = ?');
  return stmt.get(id) as BeatmapRecord | undefined;
}

export function incrementPlayCount(id: string): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE beatmaps SET play_count = play_count + 1 WHERE id = ?');
  stmt.run(id);
}

export function getRecentBeatmaps(limit: number = 10): BeatmapRecord[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM beatmaps ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as BeatmapRecord[];
}

export function saveRun(run: Omit<RunRecord, 'created_at'>): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO runs (
      id,
      title,
      handle,
      score,
      accuracy,
      max_combo,
      grade,
      perfect_count,
      good_count,
      ok_count,
      miss_count,
      bpm,
      duration,
      difficulty
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    run.id,
    run.title,
    run.handle,
    run.score,
    run.accuracy,
    run.max_combo,
    run.grade,
    run.perfect_count,
    run.good_count,
    run.ok_count,
    run.miss_count,
    run.bpm,
    run.duration,
    run.difficulty
  );
}

export function getRun(id: string): RunRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM runs WHERE id = ?');
  return stmt.get(id) as RunRecord | undefined;
}
