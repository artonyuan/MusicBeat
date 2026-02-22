import type { BeatAnalysis, Beatmap, BeatNote, DetectedBeat, LaneIndex, NoteType } from '../types/beatmap';

const APPROACH_TIME_MS = 1500; // Time for ball to travel to hit zone (used for filtering early notes)

type BeatWithContext = DetectedBeat & {
  localAvg: number;
  isHighIntensity: boolean;
};

interface HoldWindow {
  startTime: number;
  endTime: number;
  blockStartTime: number;
  blockEndTime: number;
}

/**
 * Generate a beatmap from audio analysis results.
 * This is the "gold standard" algorithm - same for all difficulty levels.
 * Difficulty only affects gameplay settings (timing windows, approach speed), not the beatmap itself.
 */
export function generateBeatmap(analysis: BeatAnalysis): Beatmap {
  const { bpm, beats, duration, usedFallback } = analysis;

  // Filter beats to create a playable map
  const filteredBeats = filterBeats(beats, bpm);

  // Convert beats to notes
  const notes = createNotes(filteredBeats, bpm, usedFallback);

  return {
    metadata: {
      title: 'Uploaded Track',
      duration,
    },
    timing: {
      bpm,
      beatDuration: 60000 / bpm,
      offsetMs: 0,
    },
    notes,
  };
}

/**
 * Filter beats to create a good rhythm game experience.
 * Keeps beats based on energy relative to local context.
 */
function filterBeats(beats: DetectedBeat[], bpm: number): BeatWithContext[] {
  const beatDuration = 60 / bpm;

  // Settings tuned for engaging gameplay
  const energyMultiplier = 0.7; // Keep beats above 70% of local average
  const minGap = beatDuration * 0.35; // Allow ~2-3 notes per beat

  // Calculate global average for context
  const globalAvg = beats.length > 0
    ? beats.reduce((sum, b) => sum + b.energy, 0) / beats.length
    : 0;

  const windowSize = 3.0; // 3 second sliding window
  const filtered: BeatWithContext[] = [];

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];

    // Skip beats too close to start (give player time to react)
    if (beat.time < APPROACH_TIME_MS / 1000 + 0.5) continue;

    // Calculate local energy average
    let localSum = 0;
    let localCount = 0;
    for (const other of beats) {
      if (Math.abs(other.time - beat.time) < windowSize) {
        localSum += other.energy;
        localCount++;
      }
    }
    const localAvg = localCount > 0 ? localSum / localCount : 0;

    // Is this a loud section?
    const isHighIntensity = localAvg > globalAvg * 1.2;

    // Keep beat if it's loud enough relative to local context
    const threshold = localAvg * energyMultiplier;
    const isLoudEnough = beat.energy >= threshold;

    // Always keep bass kicks
    if (!isLoudEnough && !beat.isBass) continue;

    // Minimum gap check
    if (filtered.length > 0) {
      const lastBeat = filtered[filtered.length - 1];
      const gap = beat.time - lastBeat.time;

      if (gap < minGap) {
        // Keep the stronger beat
        if (beat.energy > lastBeat.energy * 1.1 || (beat.isBass && !lastBeat.isBass)) {
          filtered.pop();
        } else {
          continue;
        }
      }
    }

    filtered.push({
      ...beat,
      localAvg,
      isHighIntensity,
    });
  }

  return filtered;
}

function createNotes(filteredBeats: BeatWithContext[], bpm: number, usedFallback: boolean): BeatNote[] {
  const beatInterval = 60 / bpm;

  const holdWindows: HoldWindow[] = [];

  // In fallback mode we intentionally keep the map simple and fair.
  const allowSpecials = !usedFallback;
  const allowHolds = !usedFallback;

  const desiredHoldFraction = 0.25;
  const maxHolds = allowHolds ? Math.floor(filteredBeats.length * desiredHoldFraction) : 0;

  const desiredSwitchFraction = 0.1;
  const maxSwitches = allowSpecials ? Math.floor(filteredBeats.length * desiredSwitchFraction) : 0;

  let holdsCreated = 0;
  let switchesCreated = 0;

  let occupiedUntil = -Infinity;

  let prevLane: LaneIndex = 1;
  let repeatCount = 0;
  let lastNoteTime = -Infinity;

  const baseNotes: Array<{
    beat: BeatWithContext;
    note: Omit<BeatNote, 'id'>;
  }> = [];

  for (let i = 0; i < filteredBeats.length; i++) {
    const beat = filteredBeats[i];

    if (beat.time < occupiedUntil) {
      continue;
    }

    const gapFromPrev = beat.time - lastNoteTime;
    const beatIndex = Math.round((beat.time - filteredBeats[0]!.time) / beatInterval);

    let laneIndex = chooseLaneIndex({
      beatIndex,
      isHighIntensity: beat.isHighIntensity,
      prevLane,
      repeatCount,
      gapFromPrev,
      beatInterval,
    });

    if (laneIndex === prevLane) {
      repeatCount++;
    } else {
      repeatCount = 1;
      prevLane = laneIndex;
    }

    let type: NoteType = 'normal';
    let holdEndTime: number | undefined;
    let holdTickEveryBeats: number | undefined;
    let switchFromLaneIndex: LaneIndex | undefined;

    const sustain = beat.sustain ?? 0;

    // --- HOLD (osu-like slider) ---
    // We intentionally place holds as a pattern type, not as a "gap filler".
    // Holds are only placed when the sustain signal suggests the audio is stable.
    if (
      allowHolds &&
      holdsCreated < maxHolds &&
      !beat.isBass &&
      sustain >= 0.55 &&
      gapFromPrev >= beatInterval * 0.45 &&
      !isNearHoldBlock(beat.time, holdWindows)
    ) {
      const lengthBeats = pickHoldLengthBeats({
        beatInterval,
        sustain,
        isHighIntensity: beat.isHighIntensity,
        seed: beatIndex,
      });

      const maxHoldSeconds = 2.5;
      const targetEndTime = beat.time + Math.min(lengthBeats * beatInterval, maxHoldSeconds);

      const nextBeatTime = filteredBeats[i + 1]?.time;
      const nextLimit = nextBeatTime ? nextBeatTime - 0.05 : Infinity;
      const endTime = Math.min(targetEndTime, nextLimit);

      // Ensure the hold is long enough to feel like a slider.
      const minHoldSeconds = beatInterval * 0.75;
      if (endTime - beat.time >= minHoldSeconds) {
        type = 'hold';
        holdEndTime = endTime;
        holdTickEveryBeats = 0.5;

        holdsCreated++;

        const blockPadding = beatInterval;
        holdWindows.push({
          startTime: beat.time,
          endTime,
          blockStartTime: beat.time - blockPadding,
          blockEndTime: endTime + blockPadding,
        });

        occupiedUntil = endTime + 0.05;
      }
    }

    // --- SWITCH ---
    if (
      allowSpecials &&
      type === 'normal' &&
      switchesCreated < maxSwitches &&
      beat.isHighIntensity &&
      gapFromPrev >= beatInterval * 0.45 &&
      !isNearHoldBlock(beat.time, holdWindows)
    ) {
      const shouldMakeSwitch = pseudoRandom01(beatIndex * 19.91) < 0.45;
      const prevType = baseNotes[baseNotes.length - 1]?.note.type;
      if (shouldMakeSwitch && prevType !== 'switch') {
        type = 'switch';
        switchFromLaneIndex = pickSwitchFromLane({
          targetLaneIndex: laneIndex,
          gapFromPrev,
          beatInterval,
          seed: beatIndex,
        });
        switchesCreated++;
      }
    }

    baseNotes.push({
      beat,
      note: {
        time: beat.time,
        side: 'player',
        intensity: 0.7,
        type,
        laneIndex,
        holdEndTime,
        holdTickEveryBeats,
        switchFromLaneIndex,
      },
    });

    lastNoteTime = beat.time;

    // Holds block future notes. Normal/switch notes don’t.
    if (type === 'hold' && holdEndTime !== undefined) {
      lastNoteTime = holdEndTime;
    }
  }

  const notes: Omit<BeatNote, 'id'>[] = baseNotes.map((n) => n.note);

  // --- ECHO (double tap) ---
  if (allowSpecials) {
    const desiredEchoFraction = 0.12;
    const maxEchos = Math.floor(baseNotes.length * desiredEchoFraction);

    let echosCreated = 0;
    let lastEchoBaseIndex = -999;

    for (let i = 0; i < baseNotes.length; i++) {
      if (echosCreated >= maxEchos) break;
      if (i - lastEchoBaseIndex < 2) continue; // no consecutive echo bases

      const { beat, note } = baseNotes[i];
      if (note.type !== 'normal') continue;
      if (isNearHoldBlock(note.time, holdWindows)) continue;

      const strongMoment = beat.isBass || beat.energy >= beat.localAvg * 1.25;
      if (!strongMoment) continue;

      const echoDelaySec = clamp(
        beatInterval / 2,
        0.18,
        0.33,
      );

      const echoTime = note.time + echoDelaySec;

      if (isNearHoldBlock(echoTime, holdWindows)) continue;

      const nextBaseTime = baseNotes[i + 1]?.note.time;
      if (nextBaseTime !== undefined && echoTime > nextBaseTime - 0.12) continue;

      const shouldCreateEcho = pseudoRandom01(beat.time * 123.45) < 0.35;
      if (!shouldCreateEcho) continue;

      notes.push({
        time: echoTime,
        side: 'player',
        intensity: 0.55,
        type: 'echo',
        laneIndex: note.laneIndex,
      });

      echosCreated++;
      lastEchoBaseIndex = i;
    }
  }

  // Finalize: sort + assign stable ids.
  notes.sort((a, b) => a.time - b.time);

  return notes.map((note, index) => ({
    id: `note-${index}`,
    ...note,
  }));
}

function chooseLaneIndex(input: {
  beatIndex: number;
  isHighIntensity: boolean;
  prevLane: LaneIndex;
  repeatCount: number;
  gapFromPrev: number;
  beatInterval: number;
}): LaneIndex {
  const { beatIndex, isHighIntensity, prevLane, repeatCount, gapFromPrev, beatInterval } = input;

  // If notes are extremely dense, prioritize readability.
  if (gapFromPrev < beatInterval * 0.3) {
    return prevLane;
  }

  // Force a change if we repeated too many times.
  if (repeatCount >= 3) {
    if (prevLane === 1) return pseudoRandom01(beatIndex * 7.17) < 0.5 ? 0 : 2;
    return 1;
  }

  if (isHighIntensity) {
    // Zig-zag feel: alternate sides with occasional center resets.
    if (prevLane === 1) {
      return (beatIndex % 2 === 0 ? 0 : 2) as LaneIndex;
    }

    const wantCenter = pseudoRandom01(beatIndex * 5.23) < 0.15;
    if (wantCenter) return 1;

    return (prevLane === 0 ? 2 : 0) as LaneIndex;
  }

  // Calm mode: center-biased with occasional side accents.
  const r = pseudoRandom01(beatIndex * 12.9898);

  if (prevLane === 1) {
    if (r < 0.2) return 0;
    if (r < 0.4) return 2;
    return 1;
  }

  return (r < 0.75 ? 1 : (prevLane === 0 ? 2 : 0)) as LaneIndex;
}

function pickHoldLengthBeats(input: {
  beatInterval: number;
  sustain: number;
  isHighIntensity: boolean;
  seed: number;
}): number {
  const { beatInterval, sustain, isHighIntensity, seed } = input;

  // In intense sections, keep holds shorter so they feel like quick sliders.
  if (isHighIntensity) {
    return sustain >= 0.75 && beatInterval >= 0.35 ? 2 : 1;
  }

  if (sustain >= 0.85 && beatInterval >= 0.35) {
    return pseudoRandom01(seed * 3.91) < 0.35 ? 4 : 2;
  }

  return 1;
}

function pickSwitchFromLane(input: {
  targetLaneIndex: LaneIndex;
  gapFromPrev: number;
  beatInterval: number;
  seed: number;
}): LaneIndex {
  const { targetLaneIndex, gapFromPrev, beatInterval, seed } = input;

  const dense = gapFromPrev < beatInterval * 0.6;

  if (targetLaneIndex === 1) {
    return (pseudoRandom01(seed * 11.13) < 0.5 ? 0 : 2) as LaneIndex;
  }

  if (dense) {
    return 1;
  }

  return (targetLaneIndex === 0 ? 2 : 0) as LaneIndex;
}

function isNearHoldBlock(time: number, holdWindows: HoldWindow[]): boolean {
  for (const w of holdWindows) {
    if (time >= w.blockStartTime && time <= w.blockEndTime) return true;
  }
  return false;
}

function pseudoRandom01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
