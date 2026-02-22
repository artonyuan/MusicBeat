export type GameScreen = 'upload' | 'loading' | 'playing' | 'results';

export type GamePhase = 'countdown' | 'playing' | 'paused' | 'ended';

export type HitResult = 'perfect' | 'good' | 'ok' | 'miss';

// New difficulty system: affects gameplay feel, NOT beatmap generation
export type DifficultyLevel = 'noob' | 'pro' | 'hacker';

export interface TimingWindows {
  perfect: number;  // ms
  good: number;
  ok: number;
  miss: number;
}

export interface GameplaySettings {
  timingWindows: TimingWindows;
  approachTime: number;  // seconds - how long the ball takes to reach the hit zone
  showHitZone: 'always' | 'fade' | 'hidden';
  hitZoneFadeCombo: number; // At what combo does the hit zone start fading/hide
}

export const DIFFICULTY_PRESETS: Record<DifficultyLevel, GameplaySettings> = {
  noob: {
    timingWindows: { perfect: 80, good: 150, ok: 200, miss: 250 },
    approachTime: 1.5,
    showHitZone: 'always',
    hitZoneFadeCombo: 999, // Never fades
  },
  pro: {
    timingWindows: { perfect: 50, good: 100, ok: 150, miss: 200 },
    approachTime: 1.2,
    showHitZone: 'fade',
    hitZoneFadeCombo: 20,
  },
  hacker: {
    timingWindows: { perfect: 30, good: 60, ok: 100, miss: 150 },
    approachTime: 0.9,
    showHitZone: 'hidden',
    hitZoneFadeCombo: 10,
  },
};

// Legacy constant for backwards compatibility (will be removed)
export const TIMING_WINDOWS = {
  PERFECT: 50,
  GOOD: 100,
  OK: 150,
  MISS: 200,
} as const;

export interface GameScore {
  score: number;
  combo: number;
  maxCombo: number;
  perfectCount: number;
  goodCount: number;
  okCount: number;
  missCount: number;
}

export interface HitFeedback {
  id: string;
  result: HitResult;
  x: number;
  y: number;
  timestamp: number;
}

export const SCORING = {
  perfect: { points: 100, keepCombo: true },
  good: { points: 50, keepCombo: true },
  ok: { points: 20, keepCombo: false },
  miss: { points: 0, keepCombo: false },
} as const;
