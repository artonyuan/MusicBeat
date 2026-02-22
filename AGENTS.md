# AGENTS.md - MusicBeat

> Rhythm game with auto-beatmap generation from audio files.
> Monorepo: React + Vite + Canvas2D client, Express + SQLite server.

---

## Build & Run Commands

```bash
# Development (runs both client and server concurrently)
npm run dev                 # Client on :3000, Server on :3001

# Individual workspaces
npm run dev:client          # Vite dev server only
npm run dev:server          # Express with tsx watch

# Production builds
npm run build               # Build both workspaces
npm run build:client        # Vite build -> client/dist
npm run build:server        # TypeScript compile -> server/dist

# Run production server
npm run start --workspace=server
```

## Testing

No test framework is configured yet. When adding tests:
- Use Vitest for client (integrates with Vite)
- Use Vitest or Jest for server
- Run single test: `npx vitest run path/to/test.ts`
- Watch mode: `npx vitest path/to/test.ts`

---

## Project Structure

```
MusicBeat/
├── client/                     # React frontend
│   ├── src/
│   │   ├── components/         # React components (screens, HUD)
│   │   ├── game/               # Canvas game logic (Game.tsx)
│   │   ├── audio/              # BeatDetector.ts - audio analysis
│   │   ├── beatmap/            # BeatmapGenerator.ts
│   │   ├── store/              # Zustand state (gameStore.ts)
│   │   ├── types/              # TypeScript types (game.ts, beatmap.ts)
│   │   └── styles/             # Global CSS
│   └── public/sounds/          # Hit sound effects
├── server/                     # Express backend
│   ├── src/
│   │   ├── routes/             # API routes (upload.ts, beatmap.ts)
│   │   └── db/                 # SQLite schema & queries
│   ├── uploads/                # User-uploaded audio files
│   └── data/                   # SQLite database file
└── package.json                # Workspace root
```

---

## Code Style

### TypeScript Configuration
- **Strict mode enabled** in both client and server
- **ESM modules** throughout (`"type": "module"` in package.json)
- Target: ES2020 (client), ES2022 (server)
- Client path alias: `@/*` maps to `src/*`

### Import Organization
Order imports as follows, with blank line between groups:

```typescript
// 1. External libraries
import { useEffect, useRef, useState } from 'react';
import express from 'express';

// 2. Internal modules (relative paths)
import { useGameStore } from '../store/gameStore';
import Game from '../game/Game';

// 3. Type-only imports (use `import type`)
import type { Beatmap, BeatNote } from '../types/beatmap';
import type { HitResult } from '../types/game';
```

**Server ESM requirement:** Use `.js` extension for local imports:
```typescript
import { uploadRouter } from './routes/upload.js';
import { initDatabase } from './db/schema.js';
```

**Server __dirname:** Reconstruct using:
```typescript
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

### Naming Conventions

| Element | Convention | Examples |
|---------|------------|----------|
| React components | PascalCase | `GameScreen`, `UploadScreen`, `GameHUD` |
| Component files | PascalCase.tsx | `GameScreen.tsx`, `Game.tsx` |
| Utility/logic files | PascalCase.ts | `BeatDetector.ts`, `BeatmapGenerator.ts` |
| Store/type files | camelCase.ts | `gameStore.ts`, `game.ts`, `beatmap.ts` |
| Functions | camelCase | `analyzeBeatmap`, `generateBeatmap` |
| Event handlers | `handle` prefix | `handleDrop`, `handleClick`, `handleVolumeChange` |
| Types/Interfaces | PascalCase | `GameState`, `BeatNote`, `HitResult` |
| Constants | SCREAMING_SNAKE_CASE | `TIMING_WINDOWS`, `CANVAS_WIDTH` |

### Type Patterns

Prefer **union types** over TypeScript enums:
```typescript
export type NoteType = 'normal' | 'strong' | 'hold';
export type GameScreen = 'upload' | 'loading' | 'playing' | 'results';
export type HitResult = 'perfect' | 'good' | 'ok' | 'miss';
```

Use `as const` for constant objects:
```typescript
export const TIMING_WINDOWS = {
  PERFECT: 50,
  GOOD: 100,
  OK: 150,
  MISS: 200,
} as const;
```

Use `Record<K, V>` for lookup objects:
```typescript
const colors: Record<HitResult, string> = {
  perfect: '#00ff00',
  good: '#ffff00',
  ok: '#ff8800',
  miss: '#ff0000',
};
```

### Export Patterns

- **Default exports:** React components only
- **Named exports:** Everything else (stores, types, utilities, routes, constants)

```typescript
// Component - default export
export default function GameScreen() { ... }

// Store - named export
export const useGameStore = create<GameState>(...);

// Types - named exports
export type GamePhase = 'countdown' | 'playing' | 'paused';
export interface GameScore { ... }

// Server routes - named exports
export const beatmapRouter = express.Router();
```

### React Patterns

**Functional components only** - no class components.

**Component structure:**
1. Store selectors (individual, not destructured)
2. Local state (useState)
3. Refs (useRef)
4. Helper functions
5. Event handlers (prefixed with `handle`)
6. Effects (useEffect)
7. Return JSX

**Zustand selector pattern** (prevents unnecessary re-renders):
```typescript
// Good - individual selectors
const screen = useGameStore((state) => state.screen);
const setScreen = useGameStore((state) => state.setScreen);

// Avoid - object destructuring causes re-renders on any state change
const { screen, setScreen } = useGameStore();
```

**Inline styles** using typed object at bottom of file:
```typescript
const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
};
```

### Error Handling

**Client-side:** Try/catch with console.error and user feedback:
```typescript
try {
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
} catch (error) {
  console.error('Failed to decode audio:', error);
  alert('Failed to load audio file. Please try a different file.');
}
```

**Server-side:** Try/catch with JSON error responses and status codes:
```typescript
try {
  if (!title || !duration) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // ... success logic
  res.json({ success: true, id });
} catch (error) {
  console.error('Save beatmap error:', error);
  res.status(500).json({ error: 'Failed to save beatmap' });
}
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload audio file (MP3, WAV, OGG, max 50MB) |
| POST | `/api/beatmap` | Save beatmap to database |
| GET | `/api/beatmap/:id` | Retrieve beatmap by ID |
| GET | `/api/beatmap` | List recent beatmaps |
| GET | `/api/health` | Health check |

---

## Key Implementation Notes

- **Canvas rendering:** Uses native Canvas 2D API (not PixiJS despite dependency)
- **Beat detection:** Energy analysis + bass detection + BPM autocorrelation
- **Hit timing windows:** Perfect (50ms), Good (100ms), OK (150ms), Miss (200ms)
- **Note types:** Normal, Strong (downbeats), Hold (sustained input)
- **Database:** SQLite via better-sqlite3 (synchronous API)
