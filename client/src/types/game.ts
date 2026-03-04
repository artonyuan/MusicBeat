export type GameScreen = 'upload' | 'loading' | 'playing' | 'results';

export type GamePhase = 'countdown' | 'playing' | 'paused' | 'ended';

export type HitResult = 'perfect' | 'good' | 'ok' | 'miss';
export type FailReason = 'hp_depleted' | 'miss_streak';
export type RunOutcome = 'completed' | FailReason;

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
  hpDrainPerSecond: number;
  hpGain: Record<Exclude<HitResult, 'miss'>, number>;
  hpMissPenalty: number;
  missStreakFail: number | null;
  failGraceSec: number;
}

export const DIFFICULTY_PRESETS: Record<DifficultyLevel, GameplaySettings> = {
  noob: {
    timingWindows: { perfect: 80, good: 150, ok: 200, miss: 250 },
    approachTime: 1.5,
    showHitZone: 'always',
    hitZoneFadeCombo: 999, // Never fades
    hpDrainPerSecond: 0.01,
    hpGain: { perfect: 0.04, good: 0.03, ok: 0.015 },
    hpMissPenalty: 0.08,
    missStreakFail: null,
    failGraceSec: 6,
  },
  pro: {
    timingWindows: { perfect: 50, good: 100, ok: 150, miss: 200 },
    approachTime: 1.2,
    showHitZone: 'fade',
    hitZoneFadeCombo: 20,
    hpDrainPerSecond: 0.02,
    hpGain: { perfect: 0.03, good: 0.02, ok: 0.01 },
    hpMissPenalty: 0.12,
    missStreakFail: null,
    failGraceSec: 4,
  },
  hacker: {
    timingWindows: { perfect: 30, good: 60, ok: 100, miss: 150 },
    approachTime: 0.9,
    showHitZone: 'hidden',
    hitZoneFadeCombo: 10,
    hpDrainPerSecond: 0.03,
    hpGain: { perfect: 0.02, good: 0.012, ok: 0.006 },
    hpMissPenalty: 0.18,
    missStreakFail: 3,
    failGraceSec: 2.5,
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
