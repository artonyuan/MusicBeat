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
}
