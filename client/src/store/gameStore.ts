import { create } from 'zustand';
import type { GameScreen, GamePhase, GameScore, HitResult, HitFeedback, DifficultyLevel, GameplaySettings } from '../types/game';
import type { Beatmap } from '../types/beatmap';
import { SCORING, DIFFICULTY_PRESETS } from '../types/game';

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
  recordHit: (result: HitResult, options?: { pointsMultiplier?: number; incrementCombo?: boolean }) => void;
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

  recordHit: (result, options) => {
    const { score } = get();
    const { pointsMultiplier = 1, incrementCombo = true } = options ?? {};

    const scoring = SCORING[result];

    const comboMultiplier = 1 + Math.floor(score.combo / 10) * 0.1;
    const addedPoints = scoring.points * pointsMultiplier * comboMultiplier;

    const newCombo = scoring.keepCombo
      ? (incrementCombo ? score.combo + 1 : score.combo)
      : 0;

    set({
      score: {
        ...score,
        score: score.score + addedPoints,
        combo: newCombo,
        maxCombo: Math.max(score.maxCombo, newCombo),
        [`${result}Count`]: (score[`${result}Count` as keyof GameScore] as number) + 1,
      },
    });
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

  resetScore: () => set({ score: { ...initialScore } }),

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
      hitFeedbacks: [],
    });
  },
}));
