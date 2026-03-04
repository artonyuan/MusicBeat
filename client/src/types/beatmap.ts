export type NoteType = 'normal' | 'hold' | 'echo' | 'switch';

export type LaneIndex = 0 | 1 | 2;

export interface BeatNote {
  id: string;
  time: number; // When to hit (seconds)
  side: 'player' | 'npc'; // Who should hit
  intensity: number; // 0-1, affects visual size
  type: NoteType;
  laneIndex: LaneIndex;

  // Hold notes (osu-like sliders)
  holdEndTime?: number; // Seconds
  holdTickEveryBeats?: number; // Typically 0.5 (8th-note ticks)

  // Switch notes
  switchFromLaneIndex?: LaneIndex;
}

export interface TimingInfo {
  bpm: number;
  beatDuration: number; // ms per beat
  offsetMs: number; // Audio start offset
}

export interface Beatmap {
  id?: string;
  metadata: {
    title: string;
    duration: number; // seconds
    audioUrl?: string;
  };
  timing: TimingInfo;
  notes: BeatNote[];
  debug?: BeatmapDebugReport;
}

export interface DetectedBeat {
  time: number;
  energy: number;
  isBass: boolean;
  sustain?: number; // 0-1, higher means more sustained audio
}

export interface BeatAnalysis {
  bpm: number;
  beats: DetectedBeat[]; // Enriched beat data
  duration: number;
  usedFallback: boolean;
  debug?: BeatAnalysisDebug;
}

export interface BeatDetectorDebug {
  sampleRate: number;
  offsetSec: number;
  expectedBeats: number;
  minimumDetectedBeats: number;
  minimumRawBeats: number;
  fallbackReason?: 'empty_grid' | 'sparse_grid_and_raw';
  largestRawGapSec: number;
  largestGridGapSec: number;
  stageCounts: {
    energyBeats: number;
    bassBeats: number;
    rawMergedBeats: number;
    gridBeats: number;
    finalDetectedBeats: number;
  };
}

export interface BeatAnalysisDebug {
  enabled: boolean;
  detector: BeatDetectorDebug;
}

export interface BeatmapDebugWindow {
  startSec: number;
  endSec: number;
  notes: number;
  notesPerSecond: number;
  maxGapSec: number;
  avgGapSec: number;
  laneCounts: {
    left: number;
    center: number;
    right: number;
  };
  noteTypeCounts: Record<NoteType, number>;
  laneEntropy: number; // 0-1
  typeEntropy: number; // 0-1
  longestSameLaneStreak: number;
  dropReasons: Record<string, number>;
  score: number;
}

export interface BeatmapDebugReport {
  version: number;
  generatedAt: string;
  enabled: boolean;
  durationSec: number;
  bpm: number;
  usedFallback: boolean;
  songFingerprint: string;
  binSizeSec: number;
  stageCounts: {
    detector: BeatDetectorDebug['stageCounts'];
    continuityBeats: number;
    filteredBeats: number;
    finalNotes: number;
    holdNotes: number;
    switchNotes: number;
    echoNotes: number;
  };
  holdCoverageSec: number;
  largestFinalGapSec: number;
  dropReasons: Record<string, number>;
  alerts: string[];
  windows: BeatmapDebugWindow[];
  worstWindows: BeatmapDebugWindow[];
}
