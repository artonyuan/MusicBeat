This file is a merged representation of the entire codebase, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
.claude/
  settings.local.json
client/
  src/
    audio/
      BeatDetector.ts
    beatmap/
      BeatmapGenerator.ts
    components/
      GameHUD.tsx
      GameScreen.tsx
      LoadingScreen.tsx
      ResultsScreen.tsx
      UploadScreen.tsx
    game/
      Game.tsx
    store/
      gameStore.ts
    styles/
      global.css
    types/
      beatmap.ts
      game.ts
    App.tsx
    main.tsx
    vite-env.d.ts
  index.html
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
server/
  src/
    db/
      schema.ts
    routes/
      beatmap.ts
      upload.ts
    index.ts
  package.json
  tsconfig.json
.gitignore
package.json
```

# Files

## File: .claude/settings.local.json
```json
{
  "permissions": {
    "allow": [
      "WebSearch",
      "Bash(npm run build:*)"
    ]
  }
}
```

## File: client/src/audio/BeatDetector.ts
```typescript
import type { BeatAnalysis } from '../types/beatmap';

/**
 * Analyzes an audio buffer to detect beats and BPM.
 * Improved algorithm for slowed/reverb tracks.
 */
export async function analyzeBeatmap(audioBuffer: AudioBuffer): Promise<BeatAnalysis> {
  const monoData = mixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;

  // Detect BPM
  const bpm = await detectBPM(monoData, sampleRate);

  // Detect beat positions using multiple methods and merge
  const beatPositions = detectBeatsMultiMethod(monoData, sampleRate, bpm);

  return {
    bpm,
    beatPositions,
    duration: audioBuffer.duration,
  };
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  const mono = new Float32Array(left.length);

  for (let i = 0; i < left.length; i++) {
    mono[i] = (left[i] + right[i]) / 2;
  }

  return mono;
}

async function detectBPM(samples: Float32Array, sampleRate: number): Promise<number> {
  const analysisLength = Math.min(samples.length, sampleRate * 30);
  const analysisData = samples.slice(0, analysisLength);

  // Calculate energy envelope with smaller hop for better resolution
  const hopSize = Math.floor(sampleRate / 200); // 5ms hops
  const frameSize = Math.floor(sampleRate / 20); // 50ms frames
  const envelope: number[] = [];

  for (let i = 0; i < analysisData.length - frameSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      energy += analysisData[i + j] ** 2;
    }
    envelope.push(Math.sqrt(energy / frameSize));
  }

  // Normalize envelope
  const maxEnergy = Math.max(...envelope);
  const normalizedEnvelope = envelope.map(e => e / maxEnergy);

  // Compute autocorrelation for BPM range 40-180 (wider range for slowed tracks)
  const minBPM = 40;
  const maxBPM = 180;
  const minLag = Math.floor((60 / maxBPM) * (sampleRate / hopSize));
  const maxLag = Math.floor((60 / minBPM) * (sampleRate / hopSize));

  let bestLag = minLag;
  let bestCorrelation = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    for (let i = 0; i < normalizedEnvelope.length - lag; i++) {
      correlation += normalizedEnvelope[i] * normalizedEnvelope[i + lag];
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  const beatsPerFrame = 1 / bestLag;
  const framesPerSecond = sampleRate / hopSize;
  const bpm = beatsPerFrame * framesPerSecond * 60;

  return Math.round(bpm);
}

/**
 * Detect beats using multiple methods and merge results
 */
function detectBeatsMultiMethod(
  samples: Float32Array,
  sampleRate: number,
  bpm: number
): number[] {
  // Method 1: Spectral flux (good for percussive elements)
  const spectralBeats = detectBeatsSpectralFlux(samples, sampleRate);

  // Method 2: Energy-based (good for bass/low frequencies)
  const energyBeats = detectBeatsEnergy(samples, sampleRate);

  // Method 3: Low frequency emphasis (good for slowed/bass-heavy tracks)
  const lowFreqBeats = detectBeatsLowFreq(samples, sampleRate);

  // Merge all detected beats
  const allBeats = [...spectralBeats, ...energyBeats, ...lowFreqBeats];
  allBeats.sort((a, b) => a - b);

  // Remove duplicates (beats within 50ms of each other)
  const mergedBeats = mergeNearbyBeats(allBeats, 0.05);

  // Quantize to BPM grid
  return quantizeBeats(mergedBeats, bpm);
}

function detectBeatsSpectralFlux(samples: Float32Array, sampleRate: number): number[] {
  const hopSize = Math.floor(sampleRate / 100);
  const frameSize = 2048;
  const onsetStrengths: number[] = [];
  let prevSpectrum: Float32Array | null = null;

  for (let i = 0; i < samples.length - frameSize; i += hopSize) {
    const frame = samples.slice(i, i + frameSize);
    const windowed = applyHannWindow(frame);
    const spectrum = computeMagnitudeSpectrum(windowed);

    if (prevSpectrum) {
      let flux = 0;
      for (let j = 0; j < spectrum.length; j++) {
        const diff = spectrum[j] - prevSpectrum[j];
        if (diff > 0) {
          flux += diff;
        }
      }
      onsetStrengths.push(flux);
    } else {
      onsetStrengths.push(0);
    }

    prevSpectrum = spectrum;
  }

  // Normalize
  const maxStrength = Math.max(...onsetStrengths);
  if (maxStrength === 0) return [];

  const normalized = onsetStrengths.map((s) => s / maxStrength);

  // Find peaks with adaptive threshold
  const peaks = findPeaksAdaptive(normalized, 0.15);

  return peaks.map((frameIndex) => (frameIndex * hopSize) / sampleRate);
}

function detectBeatsEnergy(samples: Float32Array, sampleRate: number): number[] {
  const hopSize = Math.floor(sampleRate / 100);
  const frameSize = Math.floor(sampleRate / 10);
  const energies: number[] = [];

  for (let i = 0; i < samples.length - frameSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      energy += samples[i + j] ** 2;
    }
    energies.push(Math.sqrt(energy / frameSize));
  }

  // Normalize
  const maxEnergy = Math.max(...energies);
  if (maxEnergy === 0) return [];

  const normalized = energies.map((e) => e / maxEnergy);

  // Compute derivative (sudden energy increases)
  const derivative: number[] = [0];
  for (let i = 1; i < normalized.length; i++) {
    derivative.push(Math.max(0, normalized[i] - normalized[i - 1]));
  }

  // Find peaks
  const peaks = findPeaksAdaptive(derivative, 0.1);

  return peaks.map((frameIndex) => (frameIndex * hopSize) / sampleRate);
}

function detectBeatsLowFreq(samples: Float32Array, sampleRate: number): number[] {
  // Simple low-pass filter to emphasize bass
  const filtered = new Float32Array(samples.length);
  const alpha = 0.1; // Low-pass coefficient

  filtered[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    filtered[i] = alpha * samples[i] + (1 - alpha) * filtered[i - 1];
  }

  // Detect energy peaks in filtered signal
  const hopSize = Math.floor(sampleRate / 50); // Larger hop for bass
  const frameSize = Math.floor(sampleRate / 5);
  const energies: number[] = [];

  for (let i = 0; i < filtered.length - frameSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      energy += filtered[i + j] ** 2;
    }
    energies.push(Math.sqrt(energy / frameSize));
  }

  const maxEnergy = Math.max(...energies);
  if (maxEnergy === 0) return [];

  const normalized = energies.map((e) => e / maxEnergy);

  // Derivative
  const derivative: number[] = [0];
  for (let i = 1; i < normalized.length; i++) {
    derivative.push(Math.max(0, normalized[i] - normalized[i - 1]));
  }

  const peaks = findPeaksAdaptive(derivative, 0.08);

  return peaks.map((frameIndex) => (frameIndex * hopSize) / sampleRate);
}

function applyHannWindow(frame: Float32Array): Float32Array {
  const windowed = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frame.length - 1)));
    windowed[i] = frame[i] * window;
  }
  return windowed;
}

function computeMagnitudeSpectrum(frame: Float32Array): Float32Array {
  const numBands = 32;
  const bandSize = Math.floor(frame.length / numBands);
  const spectrum = new Float32Array(numBands);

  for (let band = 0; band < numBands; band++) {
    let energy = 0;
    for (let i = 0; i < bandSize; i++) {
      const idx = band * bandSize + i;
      if (idx < frame.length) {
        energy += frame[idx] ** 2;
      }
    }
    spectrum[band] = Math.sqrt(energy / bandSize);
  }

  return spectrum;
}

/**
 * Find peaks with adaptive threshold based on local average
 */
function findPeaksAdaptive(data: number[], baseThreshold: number): number[] {
  const peaks: number[] = [];
  const windowSize = 20;

  for (let i = windowSize; i < data.length - windowSize; i++) {
    // Calculate local average
    let localSum = 0;
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      localSum += data[j];
    }
    const localAvg = localSum / (windowSize * 2 + 1);

    // Adaptive threshold: base threshold + local average
    const threshold = baseThreshold + localAvg * 0.5;

    // Must be above threshold
    if (data[i] < threshold) continue;

    // Must be a local maximum
    if (data[i] <= data[i - 1] || data[i] <= data[i + 1]) continue;

    // Check if it's the maximum in a small window
    let isMax = true;
    for (let j = -3; j <= 3; j++) {
      if (j !== 0 && data[i + j] >= data[i]) {
        isMax = false;
        break;
      }
    }

    if (isMax) {
      peaks.push(i);
    }
  }

  return peaks;
}

/**
 * Merge beats that are very close together
 */
function mergeNearbyBeats(beats: number[], minGap: number): number[] {
  if (beats.length === 0) return [];

  const merged: number[] = [beats[0]];

  for (let i = 1; i < beats.length; i++) {
    const lastBeat = merged[merged.length - 1];
    if (beats[i] - lastBeat >= minGap) {
      merged.push(beats[i]);
    }
  }

  return merged;
}

function quantizeBeats(beats: number[], bpm: number): number[] {
  const beatDuration = 60 / bpm;
  const gridSize = beatDuration / 4; // 16th note grid

  return beats.map((beat) => {
    const gridIndex = Math.round(beat / gridSize);
    return gridIndex * gridSize;
  });
}
```

## File: client/src/beatmap/BeatmapGenerator.ts
```typescript
import type { BeatAnalysis, Beatmap, BeatNote, Difficulty } from '../types/beatmap';

const APPROACH_TIME_MS = 1500; // Time for ball to travel to hit zone

/**
 * Generate a beatmap from audio analysis results
 */
export function generateBeatmap(
  analysis: BeatAnalysis,
  difficulty: Difficulty
): Beatmap {
  // Filter beats based on difficulty
  const filteredBeats = filterByDifficulty(analysis.beatPositions, difficulty, analysis.bpm);

  // Convert beats to notes with alternating sides
  const notes = createNotes(filteredBeats);

  return {
    metadata: {
      title: 'Uploaded Track',
      duration: analysis.duration,
    },
    timing: {
      bpm: analysis.bpm,
      beatDuration: 60000 / analysis.bpm,
      offsetMs: 0,
    },
    notes,
    difficulty,
  };
}

/**
 * Filter beats based on difficulty level
 */
function filterByDifficulty(
  beats: number[],
  difficulty: Difficulty,
  bpm: number
): number[] {
  const beatDuration = 60 / bpm; // seconds per beat

  // Difficulty affects how many beats we keep
  const keepRatios: Record<Difficulty, number> = {
    easy: 0.25, // Keep every 4th beat (quarter notes)
    normal: 0.5, // Keep every 2nd beat (half notes)
    hard: 0.75, // Keep most beats
    expert: 1.0, // Keep all beats
  };

  const keepRatio = keepRatios[difficulty];

  // Minimum gap between notes (based on difficulty)
  const minGaps: Record<Difficulty, number> = {
    easy: beatDuration * 2,
    normal: beatDuration,
    hard: beatDuration * 0.5,
    expert: beatDuration * 0.25,
  };

  const minGap = minGaps[difficulty];
  const filtered: number[] = [];

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];

    // Skip beats that are too close to start (give player time to react)
    if (beat < APPROACH_TIME_MS / 1000 + 0.5) continue;

    // Check if this beat should be kept based on ratio
    const beatIndex = Math.round(beat / beatDuration);
    const keepEveryN = Math.round(1 / keepRatio);

    // Always keep strong beats (on the downbeat)
    const isDownbeat = beatIndex % 4 === 0;
    const shouldKeepByRatio = beatIndex % keepEveryN === 0;

    if (!isDownbeat && !shouldKeepByRatio) continue;

    // Check minimum gap from last note
    if (filtered.length > 0) {
      const lastBeat = filtered[filtered.length - 1];
      if (beat - lastBeat < minGap) continue;
    }

    filtered.push(beat);
  }

  return filtered;
}

/**
 * Create note objects from beat positions
 * ALL beats are player hits for maximum dopamine!
 */
function createNotes(beats: number[]): BeatNote[] {
  return beats.map((time, index) => {
    // ALL notes are player hits - every beat = dopamine
    const side: 'player' | 'npc' = 'player';

    // Determine note type based on position in measure
    const isStrong = index % 4 === 0;

    // Intensity affects visual size (stronger beats are bigger)
    const intensity = isStrong ? 1.0 : 0.7;

    return {
      id: `note-${index}`,
      time,
      side,
      intensity,
      type: isStrong ? 'strong' : 'normal',
    };
  });
}

/**
 * Get difficulty settings
 */
export function getDifficultySettings(difficulty: Difficulty) {
  const settings = {
    easy: {
      hitWindow: 200, // ms - more forgiving
      approachTime: 2000, // ms - slower approach
      npcMissChance: 0.1, // 10% chance NPC misses
    },
    normal: {
      hitWindow: 150,
      approachTime: 1500,
      npcMissChance: 0.05,
    },
    hard: {
      hitWindow: 100,
      approachTime: 1200,
      npcMissChance: 0.02,
    },
    expert: {
      hitWindow: 75,
      approachTime: 1000,
      npcMissChance: 0.01,
    },
  };

  return settings[difficulty];
}
```

## File: client/src/components/GameHUD.tsx
```typescript
import { useGameStore } from '../store/gameStore';

interface GameHUDProps {
  currentTime: number;
  duration: number;
  onPause: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  showVolumeSlider: boolean;
  onToggleVolumeSlider: () => void;
}

export default function GameHUD({
  currentTime,
  duration,
  onPause,
  volume,
  onVolumeChange,
  showVolumeSlider,
  onToggleVolumeSlider,
}: GameHUDProps) {
  const score = useGameStore((state) => state.score);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = Math.min((currentTime / duration) * 100, 100);

  return (
    <div style={styles.container}>
      {/* Top bar */}
      <div style={styles.topBar}>
        {/* Score */}
        <div style={styles.scoreContainer}>
          <span style={styles.scoreLabel}>SCORE</span>
          <span style={styles.scoreValue}>{Math.floor(score.score).toLocaleString()}</span>
        </div>

        {/* Combo */}
        <div style={styles.comboContainer}>
          {score.combo > 0 && (
            <>
              <span style={styles.comboValue}>{score.combo}</span>
              <span style={styles.comboLabel}>COMBO</span>
            </>
          )}
        </div>

        {/* Controls */}
        <div style={styles.controlsContainer}>
          {/* Volume button */}
          <div style={styles.volumeContainer}>
            <button
              onClick={onToggleVolumeSlider}
              style={styles.controlButton}
              title="Volume"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                {volume > 0.5 ? (
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                ) : volume > 0 ? (
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                ) : (
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                )}
              </svg>
            </button>

            {/* Volume slider dropdown */}
            {showVolumeSlider && (
              <div style={styles.volumeSliderContainer}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  style={styles.volumeSlider}
                />
                <span style={styles.volumeText}>{Math.round(volume * 100)}%</span>
              </div>
            )}
          </div>

          {/* Pause button */}
          <button onClick={onPause} style={styles.controlButton} title="Pause (ESC)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress bar at bottom */}
      <div style={styles.progressContainer}>
        <span style={styles.timeText}>{formatTime(currentTime)}</span>
        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressBar,
              width: `${progress}%`,
            }}
          />
        </div>
        <span style={styles.timeText}>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '20px',
    zIndex: 10,
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  scoreContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  scoreLabel: {
    fontSize: '12px',
    color: '#a0a0a0',
    letterSpacing: '2px',
  },
  scoreValue: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#eaeaea',
  },
  comboContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minHeight: '60px',
  },
  comboValue: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#e94560',
    lineHeight: 1,
  },
  comboLabel: {
    fontSize: '12px',
    color: '#e94560',
    letterSpacing: '2px',
  },
  controlsContainer: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  volumeContainer: {
    position: 'relative',
  },
  controlButton: {
    pointerEvents: 'auto',
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '8px',
    padding: '12px',
    color: '#eaeaea',
    cursor: 'pointer',
    transition: 'background 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeSliderContainer: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '8px',
    background: 'rgba(0, 0, 0, 0.9)',
    padding: '12px 16px',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    pointerEvents: 'auto',
  },
  volumeSlider: {
    width: '100px',
    cursor: 'pointer',
    accentColor: '#e94560',
  },
  volumeText: {
    fontSize: '12px',
    color: '#a0a0a0',
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  progressTrack: {
    flex: 1,
    height: '4px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: '#e94560',
    borderRadius: '2px',
    transition: 'width 0.1s linear',
  },
  timeText: {
    fontSize: '12px',
    color: '#a0a0a0',
    fontFamily: 'monospace',
    minWidth: '45px',
  },
};
```

## File: client/src/components/GameScreen.tsx
```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import Game from '../game/Game';
import GameHUD from './GameHUD';

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [volume, setVolume] = useState(0.3); // Start at 30%
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Hit sound buffer
  const hitSoundBufferRef = useRef<AudioBuffer | null>(null);

  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const beatmap = useGameStore((state) => state.beatmap);
  const phase = useGameStore((state) => state.phase);
  const setPhase = useGameStore((state) => state.setPhase);
  const setScreen = useGameStore((state) => state.setScreen);

  // Load hit sound effect from file
  useEffect(() => {
    const loadHitSound = async () => {
      try {
        const response = await fetch('/sounds/hit.mp3');
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const audioContext = new AudioContext();
          const buffer = await audioContext.decodeAudioData(arrayBuffer);
          hitSoundBufferRef.current = buffer;
          audioContext.close();
          console.log('Loaded custom hit sound');
        } else {
          // Fallback: generate sound if file not found
          generateHitSound();
        }
      } catch (e) {
        console.log('Using generated hit sound');
        generateHitSound();
      }
    };

    const generateHitSound = async () => {
      const audioContext = new AudioContext();
      const duration = 0.1;
      const sampleRate = audioContext.sampleRate;
      const buffer = audioContext.createBuffer(1, duration * sampleRate, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const freq = 1200;
        const envelope = Math.exp(-t * 40);
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
      }

      hitSoundBufferRef.current = buffer;
      audioContext.close();
    };

    loadHitSound();
  }, []);

  // Play hit sound
  const playHitSound = useCallback(() => {
    if (!hitSoundBufferRef.current || !audioContextRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = hitSoundBufferRef.current;

    const hitGain = audioContextRef.current.createGain();
    hitGain.gain.value = 0.6;

    source.connect(hitGain);
    hitGain.connect(audioContextRef.current.destination);
    source.start(0);
  }, []);

  // Handle volume change - update gain node directly
  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);

    if (gainNodeRef.current) {
      // Direct value assignment - works immediately
      // Use small value instead of 0 to avoid clicks, but true 0 for mute
      gainNodeRef.current.gain.value = newVolume === 0 ? 0 : newVolume;
    }
  }, []);

  // Start the game audio - only call once!
  const startGame = useCallback(() => {
    // Guard: don't start if already playing
    if (!audioBuffer || audioContextRef.current) return;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Create gain node for volume control (start at 30%)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.3;
    gainNodeRef.current = gainNode;

    // Create and connect source -> gain -> destination
    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    sourceNode.onended = () => {
      setPhase('ended');
      setScreen('results');
    };

    sourceNode.start(0);
    sourceNodeRef.current = sourceNode;
    startTimeRef.current = audioContext.currentTime;

    setIsPlaying(true);
    setPhase('playing');
  }, [audioBuffer, setPhase, setScreen]);

  // Start countdown and then play
  useEffect(() => {
    if (phase !== 'countdown') return;

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          startGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [phase, startGame]);

  // Update current time
  useEffect(() => {
    if (!isPlaying || !audioContextRef.current) return;

    const updateTime = () => {
      if (audioContextRef.current) {
        const time = audioContextRef.current.currentTime - startTimeRef.current;
        setCurrentTime(time);
      }
    };

    const interval = setInterval(updateTime, 16);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        sourceNodeRef.current?.stop();
        audioContextRef.current?.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    };
  }, []);

  // Handle pause/resume
  const togglePause = useCallback(() => {
    if (phase === 'playing') {
      audioContextRef.current?.suspend();
      setPhase('paused');
    } else if (phase === 'paused') {
      audioContextRef.current?.resume();
      setPhase('playing');
    }
  }, [phase, setPhase]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  if (!beatmap) {
    return <div>No beatmap loaded</div>;
  }

  return (
    <div ref={containerRef} style={styles.container}>
      {/* Game canvas */}
      <Game
        beatmap={beatmap}
        currentTime={currentTime}
        isPlaying={isPlaying && phase === 'playing'}
        volume={volume}
        onHit={playHitSound}
      />

      {/* HUD overlay */}
      <GameHUD
        currentTime={currentTime}
        duration={beatmap.metadata.duration}
        onPause={togglePause}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        showVolumeSlider={showVolumeSlider}
        onToggleVolumeSlider={() => setShowVolumeSlider(!showVolumeSlider)}
      />

      {/* Countdown overlay */}
      {phase === 'countdown' && countdown > 0 && (
        <div style={styles.countdownOverlay}>
          <div style={styles.countdownNumber}>{countdown}</div>
          <p style={styles.countdownHint}>Press SPACE or click to hit!</p>
        </div>
      )}

      {/* Pause overlay */}
      {phase === 'paused' && (
        <div style={styles.pauseOverlay}>
          <h2 style={styles.pauseTitle}>Paused</h2>

          {/* Volume control in pause menu */}
          <div style={styles.volumeControl}>
            <span style={styles.volumeLabel}>Music Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              style={styles.volumeSlider}
            />
            <span style={styles.volumeValue}>{Math.round(volume * 100)}%</span>
          </div>

          <button onClick={togglePause} style={styles.resumeButton}>
            Resume
          </button>
          <button
            onClick={() => {
              try {
                sourceNodeRef.current?.stop();
                audioContextRef.current?.close();
              } catch (e) {}
              setScreen('upload');
            }}
            style={{ ...styles.resumeButton, background: '#3a3a5a' }}
          >
            Quit
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
    background: '#1a1a2e',
    overflow: 'hidden',
  },
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.7)',
    zIndex: 100,
  },
  countdownNumber: {
    fontSize: '120px',
    fontWeight: 700,
    color: '#e94560',
  },
  countdownHint: {
    marginTop: '20px',
    fontSize: '18px',
    color: '#a0a0a0',
  },
  pauseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    background: 'rgba(0, 0, 0, 0.85)',
    zIndex: 100,
  },
  pauseTitle: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#eaeaea',
    marginBottom: '24px',
  },
  volumeControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    padding: '16px 24px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
  },
  volumeLabel: {
    fontSize: '14px',
    color: '#a0a0a0',
    minWidth: '100px',
  },
  volumeSlider: {
    width: '150px',
    height: '8px',
    cursor: 'pointer',
    accentColor: '#e94560',
  },
  volumeValue: {
    fontSize: '14px',
    color: '#eaeaea',
    minWidth: '50px',
    textAlign: 'right',
  },
  resumeButton: {
    padding: '16px 48px',
    fontSize: '18px',
    minWidth: '200px',
  },
};
```

## File: client/src/components/LoadingScreen.tsx
```typescript
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { analyzeBeatmap } from '../audio/BeatDetector';
import { generateBeatmap } from '../beatmap/BeatmapGenerator';

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Preparing audio...');

  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const setBeatmap = useGameStore((state) => state.setBeatmap);
  const setScreen = useGameStore((state) => state.setScreen);

  useEffect(() => {
    if (!audioBuffer) {
      setScreen('upload');
      return;
    }

    const analyze = async () => {
      try {
        // Stage 1: Analyzing beats
        setStatus('Analyzing beats...');
        setProgress(20);

        const analysis = await analyzeBeatmap(audioBuffer);
        setProgress(60);

        // Stage 2: Generating beatmap
        setStatus('Generating beatmap...');
        const beatmap = generateBeatmap(analysis, 'normal');
        setProgress(90);

        // Stage 3: Done
        setStatus('Ready to play!');
        setProgress(100);

        setBeatmap(beatmap);

        // Small delay before transitioning
        setTimeout(() => {
          setScreen('playing');
        }, 500);
      } catch (error) {
        console.error('Analysis failed:', error);
        setStatus('Analysis failed. Please try another file.');
      }
    };

    analyze();
  }, [audioBuffer, setBeatmap, setScreen]);

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.loader}>
          <div style={styles.pulseRing} />
          <div style={styles.pulseRing2} />
          <div style={styles.icon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
        </div>

        <h2 style={styles.status}>{status}</h2>

        <div style={styles.progressContainer}>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${progress}%`,
              }}
            />
          </div>
          <span style={styles.progressText}>{progress}%</span>
        </div>

        <p style={styles.hint}>
          Detecting BPM and beat positions...
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  },
  content: {
    textAlign: 'center',
    padding: '40px',
  },
  loader: {
    position: 'relative',
    width: '120px',
    height: '120px',
    margin: '0 auto 32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '2px solid #e94560',
    opacity: 0.3,
    animation: 'pulse 2s ease-out infinite',
  },
  pulseRing2: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '2px solid #e94560',
    opacity: 0.3,
    animation: 'pulse 2s ease-out infinite 1s',
  },
  icon: {
    color: '#e94560',
    animation: 'spin 3s linear infinite',
  },
  status: {
    fontSize: '24px',
    fontWeight: 600,
    marginBottom: '24px',
    color: '#eaeaea',
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    maxWidth: '300px',
    margin: '0 auto 24px',
  },
  progressTrack: {
    flex: 1,
    height: '8px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #e94560, #ff6b6b)',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '14px',
    color: '#a0a0a0',
    minWidth: '40px',
  },
  hint: {
    fontSize: '14px',
    color: '#666',
  },
};

// Add keyframe animations via style tag
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse {
    0% { transform: scale(0.8); opacity: 0.5; }
    100% { transform: scale(1.5); opacity: 0; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);
```

## File: client/src/components/ResultsScreen.tsx
```typescript
import { useGameStore } from '../store/gameStore';

export default function ResultsScreen() {
  const score = useGameStore((state) => state.score);
  const resetGame = useGameStore((state) => state.resetGame);
  const setScreen = useGameStore((state) => state.setScreen);
  const setPhase = useGameStore((state) => state.setPhase);
  const resetScore = useGameStore((state) => state.resetScore);

  const totalNotes = score.perfectCount + score.goodCount + score.okCount + score.missCount;
  const accuracy = totalNotes > 0
    ? ((score.perfectCount + score.goodCount * 0.7 + score.okCount * 0.3) / totalNotes * 100).toFixed(1)
    : '0.0';

  const getGrade = () => {
    const acc = parseFloat(accuracy);
    if (acc >= 95) return { grade: 'S', color: '#fbbf24' };
    if (acc >= 90) return { grade: 'A', color: '#4ade80' };
    if (acc >= 80) return { grade: 'B', color: '#60a5fa' };
    if (acc >= 70) return { grade: 'C', color: '#a78bfa' };
    if (acc >= 60) return { grade: 'D', color: '#f97316' };
    return { grade: 'F', color: '#ef4444' };
  };

  const { grade, color } = getGrade();

  const handleRetry = () => {
    resetScore();
    setPhase('countdown');
    setScreen('playing');
  };

  const handleNewSong = () => {
    resetGame();
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>Results</h1>

        {/* Grade */}
        <div style={styles.gradeContainer}>
          <span style={{ ...styles.grade, color }}>{grade}</span>
        </div>

        {/* Score */}
        <div style={styles.scoreSection}>
          <span style={styles.scoreLabel}>Final Score</span>
          <span style={styles.scoreValue}>{Math.floor(score.score).toLocaleString()}</span>
        </div>

        {/* Stats grid */}
        <div style={styles.statsGrid}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{accuracy}%</span>
            <span style={styles.statLabel}>Accuracy</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{score.maxCombo}</span>
            <span style={styles.statLabel}>Max Combo</span>
          </div>
        </div>

        {/* Hit breakdown */}
        <div style={styles.breakdown}>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#4ade80' }}>{score.perfectCount}</span>
            <span style={styles.breakdownLabel}>Perfect</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#60a5fa' }}>{score.goodCount}</span>
            <span style={styles.breakdownLabel}>Good</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#fbbf24' }}>{score.okCount}</span>
            <span style={styles.breakdownLabel}>OK</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#ef4444' }}>{score.missCount}</span>
            <span style={styles.breakdownLabel}>Miss</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={styles.buttons}>
          <button onClick={handleRetry} style={styles.primaryButton}>
            Play Again
          </button>
          <button onClick={handleNewSong} style={styles.secondaryButton}>
            New Song
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  },
  content: {
    textAlign: 'center',
    padding: '40px',
    maxWidth: '500px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 600,
    color: '#a0a0a0',
    marginBottom: '24px',
    textTransform: 'uppercase',
    letterSpacing: '4px',
  },
  gradeContainer: {
    marginBottom: '32px',
  },
  grade: {
    fontSize: '120px',
    fontWeight: 700,
    lineHeight: 1,
    textShadow: '0 0 60px currentColor',
  },
  scoreSection: {
    marginBottom: '32px',
  },
  scoreLabel: {
    display: 'block',
    fontSize: '14px',
    color: '#a0a0a0',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
  },
  scoreValue: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#eaeaea',
  },
  statsGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: '48px',
    marginBottom: '32px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 600,
    color: '#eaeaea',
  },
  statLabel: {
    fontSize: '12px',
    color: '#a0a0a0',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  breakdown: {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    marginBottom: '48px',
    padding: '24px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
  },
  breakdownItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    minWidth: '60px',
  },
  breakdownCount: {
    fontSize: '24px',
    fontWeight: 700,
  },
  breakdownLabel: {
    fontSize: '11px',
    color: '#a0a0a0',
    textTransform: 'uppercase',
  },
  buttons: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
  },
  primaryButton: {
    padding: '16px 32px',
    fontSize: '16px',
    background: '#e94560',
    minWidth: '150px',
  },
  secondaryButton: {
    padding: '16px 32px',
    fontSize: '16px',
    background: '#3a3a5a',
    minWidth: '150px',
  },
};
```

## File: client/src/components/UploadScreen.tsx
```typescript
import { useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';

export default function UploadScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const setScreen = useGameStore((state) => state.setScreen);
  const setAudioBuffer = useGameStore((state) => state.setAudioBuffer);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('audio/')) {
      alert('Please upload an audio file (MP3, WAV, OGG)');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      setAudioBuffer(audioBuffer);
      setScreen('loading');
    } catch (error) {
      console.error('Failed to decode audio:', error);
      alert('Failed to load audio file. Please try a different file.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>MusicBeat</h1>
        <p style={styles.subtitle}>Rhythm Ping Pong</p>

        <div
          style={{
            ...styles.dropZone,
            ...(dragOver ? styles.dropZoneActive : {}),
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
        >
          <div style={styles.dropIcon}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p style={styles.dropText}>Drop your music file here</p>
          <p style={styles.dropSubtext}>or click to browse</p>
          <p style={styles.formats}>MP3, WAV, OGG supported</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileInput}
        />

        <div style={styles.instructions}>
          <h3 style={styles.instructionsTitle}>How to Play</h3>
          <ul style={styles.instructionsList}>
            <li>Upload any song you like</li>
            <li>We'll analyze the beats automatically</li>
            <li>Hit the ball in time with the music</li>
            <li>Perfect timing = maximum points!</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  },
  content: {
    textAlign: 'center',
    padding: '40px',
  },
  title: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#e94560',
    marginBottom: '8px',
    letterSpacing: '-1px',
  },
  subtitle: {
    fontSize: '18px',
    color: '#a0a0a0',
    marginBottom: '48px',
  },
  dropZone: {
    width: '400px',
    padding: '48px',
    border: '2px dashed #3a3a5a',
    borderRadius: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: 'rgba(255, 255, 255, 0.02)',
  },
  dropZoneActive: {
    borderColor: '#e94560',
    background: 'rgba(233, 69, 96, 0.1)',
  },
  dropIcon: {
    color: '#e94560',
    marginBottom: '16px',
  },
  dropText: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  dropSubtext: {
    fontSize: '14px',
    color: '#a0a0a0',
    marginBottom: '16px',
  },
  formats: {
    fontSize: '12px',
    color: '#666',
  },
  instructions: {
    marginTop: '48px',
    textAlign: 'left',
    maxWidth: '300px',
    margin: '48px auto 0',
  },
  instructionsTitle: {
    fontSize: '14px',
    color: '#a0a0a0',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  instructionsList: {
    listStyle: 'none',
    padding: 0,
    fontSize: '14px',
    color: '#eaeaea',
    lineHeight: '2',
  },
};
```

## File: client/src/game/Game.tsx
```typescript
import { useEffect, useRef, useCallback } from 'react';
import type { Beatmap, BeatNote } from '../types/beatmap';
import { useGameStore } from '../store/gameStore';
import { TIMING_WINDOWS } from '../types/game';
import type { HitResult } from '../types/game';

interface GameProps {
  beatmap: Beatmap;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  onHit: () => void;
}

// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// Table dimensions
const TABLE_WIDTH = 280;
const TABLE_HEIGHT = 380;
const TABLE_X = (CANVAS_WIDTH - TABLE_WIDTH) / 2;
const TABLE_Y = (CANVAS_HEIGHT - TABLE_HEIGHT) / 2;

// Positions
const PLAYER_Y = TABLE_Y + TABLE_HEIGHT + 35;
const NPC_Y = TABLE_Y - 55;
const CENTER_X = CANVAS_WIDTH / 2;

// Hit zone (invisible, just for logic)
const PLAYER_HIT_Y = TABLE_Y + TABLE_HEIGHT - 50;
const NPC_HIT_Y = TABLE_Y + 50;

// Ball
const BALL_SIZE = 8;
const APPROACH_TIME = 1.0;

// Colors - cleaner palette
const COLORS = {
  bg: '#2d5a27',
  bgPattern: '#347a2c',
  table: '#1565c0',
  tableBorder: '#0d47a1',
  tableLines: 'rgba(255, 255, 255, 0.6)',
  net: '#e0e0e0',
  netShadow: '#9e9e9e',
  player: '#e91e63',
  playerLight: '#f48fb1',
  npc: '#4caf50',
  npcLight: '#a5d6a7',
  skin: '#ffccbc',
  ball: '#ffeb3b',
  ballGlow: '#fff9c4',
  perfect: '#4caf50',
  good: '#2196f3',
  ok: '#ff9800',
  miss: '#f44336',
};

interface ActiveNote extends BeatNote {
  x: number;
  y: number;
  hit: boolean;
  hitResult?: HitResult;
  returnPhase: boolean;
  returnProgress: number;
  spawnTime: number;
  // Initial trajectory
  startX: number;
  targetX: number;
  velocityX: number;
  velocityY: number;
  // For missed ball physics
  missTime?: number;
  missX?: number;
  missY?: number;
}

export default function Game({ beatmap, currentTime, isPlaying, onHit }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeNotesRef = useRef<Map<string, ActiveNote>>(new Map());
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastServeTimeRef = useRef<number>(0);

  const recordHit = useGameStore((state) => state.recordHit);
  const addHitFeedback = useGameStore((state) => state.addHitFeedback);

  // Handle player input
  const handleInput = useCallback(() => {
    if (!isPlaying) return;

    const activeNotes = activeNotesRef.current;
    let closestNote: ActiveNote | undefined;
    let closestDelta = Infinity;

    activeNotes.forEach((note) => {
      if (note.hit || note.returnPhase) return;

      const delta = Math.abs((note.time - currentTime) * 1000);
      if (delta < closestDelta && delta < TIMING_WINDOWS.MISS) {
        closestDelta = delta;
        closestNote = note;
      }
    });

    if (closestNote !== undefined) {
      const note = closestNote;
      let result: HitResult;
      if (closestDelta <= TIMING_WINDOWS.PERFECT) {
        result = 'perfect';
      } else if (closestDelta <= TIMING_WINDOWS.GOOD) {
        result = 'good';
      } else if (closestDelta <= TIMING_WINDOWS.OK) {
        result = 'ok';
      } else {
        result = 'miss';
      }

      note.hit = true;
      note.hitResult = result;

      if (result !== 'miss') {
        note.returnPhase = true;
        note.returnProgress = 0;
        onHit();
      }

      recordHit(result);
      addHitFeedback({
        id: note.id,
        result,
        x: note.x,
        y: PLAYER_HIT_Y,
        timestamp: Date.now(),
      });
    }
  }, [isPlaying, currentTime, recordHit, addHitFeedback, onHit]);

  // Input handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyX') {
        e.preventDefault();
        handleInput();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        handleInput();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        e.preventDefault();
        handleInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('touchstart', handleTouchStart, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, [handleInput]);

  // Game render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;

      const activeNotes = activeNotesRef.current;

      // Add upcoming notes
      beatmap.notes.forEach((note) => {
        const timeUntil = note.time - currentTime;

        if (timeUntil > 0 && timeUntil <= APPROACH_TIME && !activeNotes.has(note.id)) {
          // Random horizontal variation for where ball lands (within table bounds)
          const targetX = CENTER_X + (Math.random() - 0.5) * 80;
          // NPC serves from slightly random position
          const startX = CENTER_X + (Math.random() - 0.5) * 40;

          activeNotes.set(note.id, {
            ...note,
            x: startX,
            y: NPC_HIT_Y,
            hit: false,
            returnPhase: false,
            returnProgress: 0,
            spawnTime: currentTime,
            startX,
            targetX,
            velocityX: 0,
            velocityY: 0,
          });

          // Track serve time for NPC animation
          lastServeTimeRef.current = currentTime;
        }
      });

      // Update note positions
      activeNotes.forEach((note, id) => {
        const timeUntil = note.time - currentTime;

        if (!note.returnPhase && !note.hit) {
          // Ball traveling from NPC to player - realistic trajectory
          const progress = Math.max(0, Math.min(1, 1 - (timeUntil / APPROACH_TIME)));

          // Linear interpolation for X (ball goes straight towards target)
          note.x = note.startX + (note.targetX - note.startX) * progress;

          // Parabolic arc for Y (like a real thrown ball with gravity)
          // Ball goes up slightly then comes down
          const arcHeight = 30; // How high the arc goes
          const yBase = NPC_HIT_Y + (PLAYER_HIT_Y - NPC_HIT_Y) * progress;
          const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
          note.y = yBase - arcOffset;

          // Handle missed notes - mark as missed but DON'T delete
          if (timeUntil < -0.12) {
            note.hit = true;
            note.hitResult = 'miss';
            // Store miss state for physics
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            // Initial velocity when missed (continuing forward)
            note.velocityX = (note.targetX - note.startX) / APPROACH_TIME;
            note.velocityY = 250; // Forward speed in pixels/sec
            recordHit('miss');
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
        } else if (note.hit && note.hitResult === 'miss' && !note.returnPhase && note.missTime !== undefined) {
          // Missed ball continues flying past player using physics
          const timeSinceMiss = currentTime - note.missTime;
          const gravity = 800; // pixels/sec^2

          // Kinematic equations: x = x0 + v*t, y = y0 + v*t + 0.5*g*t^2
          note.x = note.missX! + note.velocityX * timeSinceMiss;
          note.y = note.missY! + note.velocityY * timeSinceMiss + 0.5 * gravity * timeSinceMiss * timeSinceMiss;

          // Delete when off screen
          if (note.y > CANVAS_HEIGHT + 100) {
            activeNotes.delete(id);
            return;
          }
        } else if (note.returnPhase) {
          note.returnProgress += deltaTime * 2.5;

          if (note.returnProgress >= 1) {
            activeNotes.delete(id);
            return;
          }

          // Return arc - ball hit back to NPC
          const returnProgress = note.returnProgress;
          const startY = PLAYER_HIT_Y;
          const endY = NPC_HIT_Y;

          // Linear Y with arc
          const yBase = startY + (endY - startY) * returnProgress;
          const returnArc = Math.sin(returnProgress * Math.PI) * 40;
          note.y = yBase - returnArc;

          // X goes back towards center with slight variation
          const returnTargetX = CENTER_X + (Math.random() - 0.5) * 20;
          note.x = note.x + (returnTargetX - note.x) * returnProgress;
        }
      });

      // Clear canvas
      ctx.imageSmoothingEnabled = true;

      // Draw scene
      drawBackground(ctx);
      drawTable(ctx);

      // Draw characters with animation state
      const npcServeAnim = Math.max(0, 1 - (currentTime - lastServeTimeRef.current) * 5);
      drawCharacter(ctx, CENTER_X, NPC_Y, 'npc', npcServeAnim);
      drawCharacter(ctx, CENTER_X, PLAYER_Y, 'player', 0);

      // Draw balls with effects
      activeNotes.forEach((note) => {
        const timeUntil = note.time - currentTime;
        const isMissed = note.hit && note.hitResult === 'miss';

        // Draw approach circle at target position when ball is incoming
        if (!note.hit && !note.returnPhase && timeUntil < 0.5 && timeUntil > -0.1) {
          drawApproachCircle(ctx, note.targetX, PLAYER_HIT_Y, timeUntil);
        }

        // Draw ball trail for incoming balls
        if (!note.hit && !note.returnPhase) {
          drawBallTrail(ctx, note, currentTime);
        }

        // Draw ball (including missed balls flying away)
        drawBall(ctx, note.x, note.y, isMissed, note.intensity, note.returnPhase);
      });

      // Hit feedback
      drawHitFeedback(ctx);

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentTime, beatmap, isPlaying, recordHit, addHitFeedback]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        cursor: 'pointer',
      }}
    />
  );
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  // Gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#1b4d1a');
  gradient.addColorStop(1, '#2d5a27');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Subtle pattern
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let x = 0; x < CANVAS_WIDTH; x += 20) {
    for (let y = 0; y < CANVAS_HEIGHT; y += 20) {
      if ((x + y) % 40 === 0) {
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawTable(ctx: CanvasRenderingContext2D) {
  // Table shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.roundRect(TABLE_X + 6, TABLE_Y + 6, TABLE_WIDTH, TABLE_HEIGHT, 4);
  ctx.fill();

  // Table surface
  const tableGradient = ctx.createLinearGradient(TABLE_X, TABLE_Y, TABLE_X, TABLE_Y + TABLE_HEIGHT);
  tableGradient.addColorStop(0, '#1976d2');
  tableGradient.addColorStop(1, '#1565c0');
  ctx.fillStyle = tableGradient;
  ctx.beginPath();
  ctx.roundRect(TABLE_X, TABLE_Y, TABLE_WIDTH, TABLE_HEIGHT, 4);
  ctx.fill();

  // Table border
  ctx.strokeStyle = COLORS.tableBorder;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Inner white line
  ctx.strokeStyle = COLORS.tableLines;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(TABLE_X + 12, TABLE_Y + 12, TABLE_WIDTH - 24, TABLE_HEIGHT - 24, 2);
  ctx.stroke();

  // Center line
  ctx.beginPath();
  ctx.moveTo(TABLE_X + 12, TABLE_Y + TABLE_HEIGHT / 2);
  ctx.lineTo(TABLE_X + TABLE_WIDTH - 12, TABLE_Y + TABLE_HEIGHT / 2);
  ctx.stroke();

  // Net
  const netY = TABLE_Y + TABLE_HEIGHT / 2;
  ctx.fillStyle = COLORS.netShadow;
  ctx.fillRect(TABLE_X - 8, netY + 1, TABLE_WIDTH + 16, 5);
  ctx.fillStyle = COLORS.net;
  ctx.fillRect(TABLE_X - 8, netY - 2, TABLE_WIDTH + 16, 5);

  // Net posts
  ctx.fillStyle = '#757575';
  ctx.fillRect(TABLE_X - 10, netY - 6, 4, 14);
  ctx.fillRect(TABLE_X + TABLE_WIDTH + 6, netY - 6, 4, 14);
}

function drawApproachCircle(ctx: CanvasRenderingContext2D, x: number, y: number, timeUntil: number) {
  // Pulsing circle that shrinks as ball approaches
  const maxRadius = 45;
  const minRadius = 12;
  const progress = Math.max(0, timeUntil / 0.5);
  const radius = minRadius + (maxRadius - minRadius) * progress;
  const alpha = 0.2 + (1 - progress) * 0.4;

  // Outer glow
  ctx.beginPath();
  ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(233, 30, 99, ${alpha * 0.2})`;
  ctx.fill();

  // Main circle
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(233, 30, 99, ${alpha})`;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Inner target dot that appears when close
  if (progress < 0.25) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(233, 30, 99, ${(0.25 - progress) * 3})`;
    ctx.fill();
  }
}

function drawBallTrail(ctx: CanvasRenderingContext2D, note: ActiveNote, currentTime: number) {
  const trailLength = 5;
  const timeUntil = note.time - currentTime;
  const progress = Math.max(0, Math.min(1, 1 - (timeUntil / APPROACH_TIME)));

  for (let i = trailLength; i > 0; i--) {
    const trailProgress = Math.max(0, progress - i * 0.03);
    if (trailProgress <= 0) continue;

    // Match the realistic trajectory
    const trailX = note.startX + (note.targetX - note.startX) * trailProgress;
    const arcHeight = 30;
    const yBase = NPC_HIT_Y + (PLAYER_HIT_Y - NPC_HIT_Y) * trailProgress;
    const arcOffset = Math.sin(trailProgress * Math.PI) * arcHeight;
    const trailY = yBase - arcOffset;

    const alpha = (1 - i / trailLength) * 0.3;
    const size = BALL_SIZE * (1 - i / trailLength) * 0.7;

    ctx.beginPath();
    ctx.arc(trailX, trailY, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 235, 59, ${alpha})`;
    ctx.fill();
  }
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isMiss: boolean,
  intensity: number,
  isReturn: boolean
) {
  if (isMiss) {
    ctx.globalAlpha = 0.4;
  }

  const size = BALL_SIZE * (0.9 + intensity * 0.2);

  // Glow effect
  if (!isMiss) {
    const glowSize = size * (isReturn ? 2 : 2.5);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
    gradient.addColorStop(0, 'rgba(255, 235, 59, 0.4)');
    gradient.addColorStop(0.5, 'rgba(255, 235, 59, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 235, 59, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, glowSize, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ball shadow
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 3, size * 0.8, size * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fill();

  // Main ball
  const ballGradient = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, 0, x, y, size);
  ballGradient.addColorStop(0, '#fff9c4');
  ballGradient.addColorStop(0.3, COLORS.ball);
  ballGradient.addColorStop(1, '#f9a825');
  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.beginPath();
  ctx.arc(x - size * 0.3, y - size * 0.3, size * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fill();

  ctx.globalAlpha = 1;
}

function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, type: 'player' | 'npc', swingAnim: number = 0) {
  const isPlayer = type === 'player';
  const mainColor = isPlayer ? COLORS.player : COLORS.npc;
  const lightColor = isPlayer ? COLORS.playerLight : COLORS.npcLight;

  // Animation offset for swing
  const swingOffset = swingAnim * 8;
  const swingRotation = swingAnim * 0.3;

  // Shadow
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 14, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fill();

  // Body
  ctx.fillStyle = isPlayer ? '#7b1fa2' : '#455a64';
  ctx.fillRect(x - 10, y - 6, 20, 18);

  // Head
  ctx.fillStyle = COLORS.skin;
  ctx.beginPath();
  ctx.arc(x, y - 14, 9, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = isPlayer ? '#4a148c' : '#263238';
  ctx.beginPath();
  ctx.arc(x, y - 16, 9, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 9, y - 18, 18, 4);

  // Eyes
  ctx.fillStyle = '#212121';
  const eyeY = isPlayer ? y - 14 : y - 12;
  ctx.fillRect(x - 4, eyeY, 2, 2);
  ctx.fillRect(x + 2, eyeY, 2, 2);

  // Paddle arm with animation
  const baseArmX = x + 6;
  const basePaddleX = x + 12;
  const paddleY = isPlayer ? y - 20 : y + 8;

  ctx.save();

  if (!isPlayer && swingAnim > 0) {
    // NPC swing animation - rotate paddle forward when serving
    const pivotX = x + 6;
    const pivotY = y;
    ctx.translate(pivotX, pivotY);
    ctx.rotate(swingRotation);
    ctx.translate(-pivotX, -pivotY);
  }

  // Arm
  ctx.fillStyle = COLORS.skin;
  ctx.fillRect(baseArmX, isPlayer ? y - 14 : y - 2, 6, 14);

  // Paddle
  const paddleDrawX = basePaddleX - 2 + (isPlayer ? 0 : swingOffset);
  const paddleDrawY = paddleY + (isPlayer ? 0 : swingOffset);

  ctx.fillStyle = mainColor;
  ctx.beginPath();
  ctx.roundRect(paddleDrawX, paddleDrawY, 14, 18, 2);
  ctx.fill();

  // Paddle rubber
  ctx.fillStyle = '#212121';
  ctx.fillRect(paddleDrawX + 3, paddleDrawY + 3, 8, 11);
  ctx.fillStyle = lightColor;
  ctx.fillRect(paddleDrawX + 4, paddleDrawY + 4, 6, 9);

  ctx.restore();
}

function drawHitFeedback(ctx: CanvasRenderingContext2D) {
  const feedbacks = useGameStore.getState().hitFeedbacks;
  const now = Date.now();

  feedbacks.forEach((feedback) => {
    const age = now - feedback.timestamp;
    if (age > 500) return;

    const alpha = 1 - age / 500;
    const yOffset = age / 5;
    const scale = 1 + age / 600;

    const colors: Record<HitResult, string> = {
      perfect: COLORS.perfect,
      good: COLORS.good,
      ok: COLORS.ok,
      miss: COLORS.miss,
    };

    const labels: Record<HitResult, string> = {
      perfect: 'PERFECT',
      good: 'GOOD',
      ok: 'OK',
      miss: 'MISS',
    };

    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.floor(18 * scale)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillText(labels[feedback.result], feedback.x + 1, feedback.y - yOffset - 39);

    // Text
    ctx.fillStyle = colors[feedback.result];
    ctx.fillText(labels[feedback.result], feedback.x, feedback.y - yOffset - 40);

    ctx.globalAlpha = 1;
  });

  useGameStore.getState().clearOldFeedbacks();
}
```

## File: client/src/store/gameStore.ts
```typescript
import { create } from 'zustand';
import type { GameScreen, GamePhase, GameScore, HitResult, HitFeedback } from '../types/game';
import type { Beatmap } from '../types/beatmap';
import { SCORING } from '../types/game';

interface GameState {
  // Navigation
  screen: GameScreen;
  setScreen: (screen: GameScreen) => void;

  // Game phase
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  // Current beatmap
  beatmap: Beatmap | null;
  setBeatmap: (beatmap: Beatmap | null) => void;

  // Audio buffer
  audioBuffer: AudioBuffer | null;
  setAudioBuffer: (buffer: AudioBuffer | null) => void;

  // Score tracking
  score: GameScore;
  recordHit: (result: HitResult) => void;
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

export const useGameStore = create<GameState>((set, get) => ({
  screen: 'upload',
  setScreen: (screen) => set({ screen }),

  phase: 'countdown',
  setPhase: (phase) => set({ phase }),

  beatmap: null,
  setBeatmap: (beatmap) => set({ beatmap }),

  audioBuffer: null,
  setAudioBuffer: (audioBuffer) => set({ audioBuffer }),

  score: { ...initialScore },

  recordHit: (result) => {
    const { score } = get();
    const scoring = SCORING[result];
    const newCombo = scoring.keepCombo ? score.combo + 1 : 0;

    set({
      score: {
        ...score,
        score: score.score + scoring.points * (1 + Math.floor(score.combo / 10) * 0.1),
        combo: newCombo,
        maxCombo: Math.max(score.maxCombo, newCombo),
        [`${result}Count`]: score[`${result}Count` as keyof GameScore] as number + 1,
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
      score: { ...initialScore },
      hitFeedbacks: [],
    });
  },
}));
```

## File: client/src/styles/global.css
```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --accent: #e94560;
  --accent-soft: #ff6b6b;
  --text-primary: #eaeaea;
  --text-secondary: #a0a0a0;
  --success: #4ade80;
  --warning: #fbbf24;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--text-primary);
}

button {
  cursor: pointer;
  border: none;
  background: var(--accent);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  transition: all 0.2s ease;
}

button:hover {
  background: var(--accent-soft);
  transform: translateY(-2px);
}

button:active {
  transform: translateY(0);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

input[type="file"] {
  display: none;
}
```

## File: client/src/types/beatmap.ts
```typescript
export interface BeatNote {
  id: string;
  time: number; // When to hit (seconds)
  side: 'player' | 'npc'; // Who should hit
  intensity: number; // 0-1, affects visual size
  type: 'normal' | 'strong';
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
  difficulty: Difficulty;
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface BeatAnalysis {
  bpm: number;
  beatPositions: number[]; // Array of beat times in seconds
  duration: number;
}
```

## File: client/src/types/game.ts
```typescript
export type GameScreen = 'upload' | 'loading' | 'playing' | 'results';

export type GamePhase = 'countdown' | 'playing' | 'paused' | 'ended';

export type HitResult = 'perfect' | 'good' | 'ok' | 'miss';

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

export const TIMING_WINDOWS = {
  PERFECT: 50, // ms
  GOOD: 100,
  OK: 150,
  MISS: 200,
} as const;

export const SCORING = {
  perfect: { points: 100, keepCombo: true },
  good: { points: 50, keepCombo: true },
  ok: { points: 20, keepCombo: false },
  miss: { points: 0, keepCombo: false },
} as const;
```

## File: client/src/App.tsx
```typescript
import { useGameStore } from './store/gameStore';
import UploadScreen from './components/UploadScreen';
import LoadingScreen from './components/LoadingScreen';
import GameScreen from './components/GameScreen';
import ResultsScreen from './components/ResultsScreen';

function App() {
  const screen = useGameStore((state) => state.screen);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {screen === 'upload' && <UploadScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'playing' && <GameScreen />}
      {screen === 'results' && <ResultsScreen />}
    </div>
  );
}

export default App;
```

## File: client/src/main.tsx
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

## File: client/src/vite-env.d.ts
```typescript
/// <reference types="vite/client" />
```

## File: client/index.html
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MusicBeat - Rhythm Ping Pong</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body, #root {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #1a1a2e;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## File: client/package.json
```json
{
  "name": "musicbeat-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "pixi.js": "^8.0.0",
    "@pixi/react": "^8.0.0",
    "zustand": "^4.5.0",
    "essentia.js": "^0.1.3"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.12",
    "typescript": "^5.3.3"
  }
}
```

## File: client/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

## File: client/tsconfig.node.json
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

## File: client/vite.config.ts
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['essentia.js'],
  },
});
```

## File: server/src/db/schema.ts
```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/musicbeat.db');

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(dbPath);
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
```

## File: server/src/routes/beatmap.ts
```typescript
import express from 'express';
import { nanoid } from 'nanoid';
import { saveBeatmap, getBeatmap, incrementPlayCount, getRecentBeatmaps } from '../db/schema.js';

export const beatmapRouter = express.Router();

// Save a new beatmap
beatmapRouter.post('/', (req, res) => {
  try {
    const { title, duration, bpm, difficulty, audioFilename, notes } = req.body;

    if (!title || !duration || !bpm || !audioFilename || !notes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = nanoid(10);

    saveBeatmap({
      id,
      title,
      duration,
      bpm,
      difficulty: difficulty || 'normal',
      audio_filename: audioFilename,
      notes_json: JSON.stringify(notes),
    });

    // Generate shareable URL
    const shareUrl = `/play/${id}`;

    res.json({
      success: true,
      id,
      shareUrl,
    });
  } catch (error) {
    console.error('Save beatmap error:', error);
    res.status(500).json({ error: 'Failed to save beatmap' });
  }
});

// Get beatmap by ID
beatmapRouter.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const beatmap = getBeatmap(id);

    if (!beatmap) {
      return res.status(404).json({ error: 'Beatmap not found' });
    }

    // Increment play count
    incrementPlayCount(id);

    // Parse notes from JSON
    const notes = JSON.parse(beatmap.notes_json);

    res.json({
      id: beatmap.id,
      title: beatmap.title,
      duration: beatmap.duration,
      bpm: beatmap.bpm,
      difficulty: beatmap.difficulty,
      audioUrl: `/uploads/${beatmap.audio_filename}`,
      notes,
      playCount: beatmap.play_count + 1,
      createdAt: beatmap.created_at,
    });
  } catch (error) {
    console.error('Get beatmap error:', error);
    res.status(500).json({ error: 'Failed to get beatmap' });
  }
});

// Get recent/popular beatmaps
beatmapRouter.get('/', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const beatmaps = getRecentBeatmaps(limit);

    const formatted = beatmaps.map((b) => ({
      id: b.id,
      title: b.title,
      duration: b.duration,
      bpm: b.bpm,
      difficulty: b.difficulty,
      playCount: b.play_count,
      createdAt: b.created_at,
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get beatmaps error:', error);
    res.status(500).json({ error: 'Failed to get beatmaps' });
  }
});
```

## File: server/src/routes/upload.ts
```typescript
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = nanoid(10);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/x-wav'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP3, WAV, and OGG are allowed.'));
    }
  },
});

export const uploadRouter = express.Router();

// Upload audio file
uploadRouter.post('/', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const audioUrl = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      audioUrl,
      size: req.file.size,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Error handler for multer
uploadRouter.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
  }
  res.status(400).json({ error: err.message });
});
```

## File: server/src/index.ts
```typescript
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadRouter } from './routes/upload.js';
import { beatmapRouter } from './routes/beatmap.js';
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`MusicBeat server running on http://localhost:${PORT}`);
});

export default app;
```

## File: server/package.json
```json
{
  "name": "musicbeat-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "multer": "^1.4.5-lts.1",
    "nanoid": "^5.0.4",
    "better-sqlite3": "^9.4.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/multer": "^1.4.11",
    "@types/better-sqlite3": "^7.6.9",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

## File: server/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

## File: .gitignore
```
# Dependencies
node_modules/

# Build output
dist/
build/

# Environment files
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Data files (local development)
server/data/
server/uploads/

# Cache
.cache/
*.tsbuildinfo
```

## File: package.json
```json
{
  "name": "musicbeat",
  "version": "1.0.0",
  "private": true,
  "description": "Rhythm ping pong game with auto-beatmap generation",
  "scripts": {
    "dev": "concurrently \"npm run dev:client\" \"npm run dev:server\"",
    "dev:client": "npm run dev --workspace=client",
    "dev:server": "npm run dev --workspace=server",
    "build": "npm run build --workspace=client && npm run build --workspace=server",
    "build:client": "npm run build --workspace=client",
    "build:server": "npm run build --workspace=server"
  },
  "workspaces": [
    "client",
    "server"
  ],
  "devDependencies": {
    "concurrently": "^8.2.2",
    "typescript": "^5.3.3"
  }
}
```
