import { create } from 'zustand';

import { SCORING, DIFFICULTY_PRESETS } from '../types/game';

import type {
  GameScreen,
  GamePhase,
  GameScore,
  HitResult,
  HitFeedback,
  DifficultyLevel,
  GameplaySettings,
  RunOutcome,
} from '../types/game';
import type { Beatmap } from '../types/beatmap';

interface GameState {
  // Navigation
  screen: GameScreen;
  setScreen: (screen: GameScreen) => void;

  // Game settings
  difficulty: DifficultyLevel;
  setDifficulty: (difficulty: DifficultyLevel) => void;
  getGameplaySettings: () => GameplaySettings;

  // Game phase
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  // Current beatmap
  beatmap: Beatmap | null;
  setBeatmap: (beatmap: Beatmap | null) => void;

  // Audio buffer
  audioBuffer: AudioBuffer | null;
  setAudioBuffer: (buffer: AudioBuffer | null) => void;

  // Run metadata
  playerHandle: string;
  setPlayerHandle: (handle: string) => void;
  songTitle: string;
  setSongTitle: (title: string) => void;

  // Score tracking
  score: GameScore;
  health: number;
  missStreak: number;
  runOutcome: RunOutcome | null;
  setRunOutcome: (outcome: RunOutcome | null) => void;
  recordHit: (result: HitResult, options?: { pointsMultiplier?: number; incrementCombo?: boolean }) => void;
  applyPassiveDrain: (deltaSeconds: number) => void;
  addPoints: (points: number) => void;
  resetScore: () => void;

  // Hit feedback for visual effects
  hitFeedbacks: HitFeedback[];
  addHitFeedback: (feedback: HitFeedback) => void;
  clearOldFeedbacks: () => void;

  // Reset game
  resetGame: () => void;
}

const initialScore: GameScore = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfectCount: 0,
  goodCount: 0,
  okCount: 0,
  missCount: 0,
};
const MAX_HEALTH = 1;
const MIN_HEALTH = 0;

function clampHealth(value: number) {
  return Math.max(MIN_HEALTH, Math.min(MAX_HEALTH, value));
}

const storedHandle = typeof window !== 'undefined'
  ? window.localStorage.getItem('musicbeat:handle')
  : null;
const defaultHandle = storedHandle && storedHandle.trim() ? storedHandle : 'player';

export const useGameStore = create<GameState>((set, get) => ({
  screen: 'upload',
  setScreen: (screen) => set({ screen }),

  difficulty: 'pro', // Default to 'pro' for best experience
  setDifficulty: (difficulty) => set({ difficulty }),
  getGameplaySettings: () => DIFFICULTY_PRESETS[get().difficulty],

  phase: 'countdown',
  setPhase: (phase) => set({ phase }),

  beatmap: null,
  setBeatmap: (beatmap) => set({ beatmap }),

  audioBuffer: null,
  setAudioBuffer: (audioBuffer) => set({ audioBuffer }),

  playerHandle: defaultHandle,
  setPlayerHandle: (playerHandle) => {
    const trimmedHandle = playerHandle.trim();
    if (typeof window !== 'undefined' && trimmedHandle) {
      window.localStorage.setItem('musicbeat:handle', trimmedHandle);
    }
    set({ playerHandle });
  },

  songTitle: '',
  setSongTitle: (songTitle) => set({ songTitle }),

  score: { ...initialScore },
  health: MAX_HEALTH,
  missStreak: 0,
  runOutcome: null,
  setRunOutcome: (runOutcome) => set({ runOutcome }),

  recordHit: (result, options) => {
    const { score, health, missStreak } = get();
    const { pointsMultiplier = 1, incrementCombo = true } = options ?? {};
    const gameplaySettings = DIFFICULTY_PRESETS[get().difficulty];

    const scoring = SCORING[result];

    const comboMultiplier = 1 + Math.floor(score.combo / 10) * 0.1;
    const addedPoints = scoring.points * pointsMultiplier * comboMultiplier;

    const newCombo = scoring.keepCombo
      ? (incrementCombo ? score.combo + 1 : score.combo)
      : 0;
    const newMissStreak = result === 'miss' ? missStreak + 1 : 0;
    const healthDelta = result === 'miss'
      ? -gameplaySettings.hpMissPenalty
      : gameplaySettings.hpGain[result];
    const nextHealth = clampHealth(health + healthDelta);

    set({
      score: {
        ...score,
        score: score.score + addedPoints,
        combo: newCombo,
        maxCombo: Math.max(score.maxCombo, newCombo),
        [`${result}Count`]: (score[`${result}Count` as keyof GameScore] as number) + 1,
      },
      health: nextHealth,
      missStreak: newMissStreak,
    });
  },

  applyPassiveDrain: (deltaSeconds) => {
    if (deltaSeconds <= 0) return;

    const { health } = get();
    const gameplaySettings = DIFFICULTY_PRESETS[get().difficulty];
    const drainedHealth = clampHealth(health - gameplaySettings.hpDrainPerSecond * deltaSeconds);

    if (drainedHealth === health) return;
    set({ health: drainedHealth });
  },

  addPoints: (points) => {
    const { score } = get();
    const comboMultiplier = 1 + Math.floor(score.combo / 10) * 0.1;

    set({
      score: {
        ...score,
        score: score.score + points * comboMultiplier,
      },
    });
  },

  resetScore: () => set({
    score: { ...initialScore },
    health: MAX_HEALTH,
    missStreak: 0,
    runOutcome: null,
  }),

  hitFeedbacks: [],
  addHitFeedback: (feedback) => {
    set((state) => ({
      hitFeedbacks: [...state.hitFeedbacks, feedback],
    }));
  },
  clearOldFeedbacks: () => {
    const now = Date.now();
    set((state) => ({
      hitFeedbacks: state.hitFeedbacks.filter((f) => now - f.timestamp < 1000),
    }));
  },

  resetGame: () => {
    set({
      screen: 'upload',
      phase: 'countdown',
      beatmap: null,
      audioBuffer: null,
      songTitle: '',
      score: { ...initialScore },
      health: MAX_HEALTH,
      missStreak: 0,
      runOutcome: null,
      hitFeedbacks: [],
    });
  },
}));
