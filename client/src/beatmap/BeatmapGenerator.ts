import { exposeBeatmapDebug, isBeatmapDebugEnabled } from './beatmapDebug';

import type { BeatAnalysis, Beatmap, BeatmapDebugReport, BeatmapDebugWindow, BeatNote, DetectedBeat, LaneIndex, NoteType } from '../types/beatmap';

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

interface BeatDropEvent {
  timeSec: number;
  reason: string;
}

interface GenerationDebugState {
  enabled: boolean;
  dropReasons: Record<string, number>;
  dropEvents: BeatDropEvent[];
  holdCoverageSec: number;
  backfilledBeats: number;
}

interface ReinforcedBeatResult {
  beats: DetectedBeat[];
  insertedCount: number;
}

const DEBUG_BIN_SIZE_SEC = 2;

/**
 * Generate a beatmap from audio analysis results.
 * This is the "gold standard" algorithm - same for all difficulty levels.
 * Difficulty only affects gameplay settings (timing windows, approach speed), not the beatmap itself.
 */
export function generateBeatmap(analysis: BeatAnalysis): Beatmap {
  const { bpm, beats, duration, usedFallback } = analysis;
  const debugState = createGenerationDebugState(isBeatmapDebugEnabled() || analysis.debug?.enabled === true);

  const reinforced = reinforceBeatContinuity(beats, bpm);
  const stabilizedBeats = reinforced.beats;
  debugState.backfilledBeats = reinforced.insertedCount;

  // Filter beats to create a playable map
  const filteredBeats = filterBeats(stabilizedBeats, bpm, debugState);

  // Convert beats to notes
  const notes = createNotes(filteredBeats, bpm, usedFallback, debugState);

  const debug = debugState.enabled
    ? buildBeatmapDebugReport({
      analysis,
      bpm,
      duration,
      usedFallback,
      stabilizedBeatsCount: stabilizedBeats.length,
      filteredBeatsCount: filteredBeats.length,
      notes,
      debugState,
    })
    : undefined;

  if (debug !== undefined) {
    exposeBeatmapDebug(debug);
  }

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
    debug,
  };
}

/**
 * Filter beats to create a good rhythm game experience.
 * Keeps beats based on energy relative to local context.
 */
function filterBeats(beats: DetectedBeat[], bpm: number, debugState?: GenerationDebugState): BeatWithContext[] {
  const beatDuration = 60 / bpm;
  const highTempo = bpm >= 150;
  const sortedBeats = [...beats].sort((a, b) => a.time - b.time);

  // Settings tuned for engaging gameplay
  const energyMultiplier = highTempo ? 0.58 : 0.65;
  const minGap = beatDuration * (highTempo ? 0.18 : 0.24);

  // Calculate global average for context
  const globalAvg = sortedBeats.length > 0
    ? sortedBeats.reduce((sum, b) => sum + b.energy, 0) / sortedBeats.length
    : 0;

  const windowSize = highTempo ? 1.2 : 1.8;
  const localAverages = computeLocalEnergyAverages(sortedBeats, windowSize);
  const filtered: BeatWithContext[] = [];

  for (let i = 0; i < sortedBeats.length; i++) {
    const beat = sortedBeats[i];

    // Skip beats too close to start (give player time to react)
    if (beat.time < APPROACH_TIME_MS / 1000 + 0.5) {
      recordDrop(debugState, 'filtered_preroll', beat.time);
      continue;
    }

    const localAvg = localAverages[i] ?? beat.energy;

    // Is this a loud section?
    const intensityThreshold = highTempo ? 1.08 : 1.15;
    const isHighIntensity = localAvg > globalAvg * intensityThreshold;

    // Keep beat if it's loud enough relative to local context
    const dynamicEnergyMultiplier = isHighIntensity ? energyMultiplier - 0.06 : energyMultiplier;
    const threshold = localAvg * dynamicEnergyMultiplier;
    const isLoudEnough = beat.energy >= threshold;

    // Always keep bass kicks
    if (!isLoudEnough && !beat.isBass) {
      recordDrop(debugState, 'filtered_low_energy', beat.time);
      continue;
    }

    // Minimum gap check
    if (filtered.length > 0) {
      const lastBeat = filtered[filtered.length - 1];
      const gap = beat.time - lastBeat.time;

      const effectiveMinGap = isHighIntensity ? minGap * 0.8 : minGap;

      if (gap < effectiveMinGap) {
        // Keep the stronger beat
        if (beat.energy > lastBeat.energy * 1.02 || (beat.isBass && !lastBeat.isBass)) {
          recordDrop(debugState, 'filtered_min_gap_replaced_previous', lastBeat.time);
          filtered.pop();
        } else {
          recordDrop(debugState, 'filtered_min_gap_weaker', beat.time);
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

function computeLocalEnergyAverages(beats: DetectedBeat[], windowRadiusSec: number): number[] {
  if (beats.length === 0) return [];

  const averages = new Array<number>(beats.length);
  let left = 0;
  let right = 0;
  let rollingEnergy = 0;

  for (let i = 0; i < beats.length; i++) {
    const centerTime = beats[i]!.time;
    const minTime = centerTime - windowRadiusSec;
    const maxTime = centerTime + windowRadiusSec;

    while (left < beats.length && beats[left]!.time < minTime) {
      rollingEnergy -= beats[left]!.energy;
      left++;
    }

    while (right < beats.length && beats[right]!.time < maxTime) {
      rollingEnergy += beats[right]!.energy;
      right++;
    }

    const windowCount = right - left;
    averages[i] = windowCount > 0 ? rollingEnergy / windowCount : beats[i]!.energy;
  }

  return averages;
}

function createNotes(
  filteredBeats: BeatWithContext[],
  bpm: number,
  usedFallback: boolean,
  debugState?: GenerationDebugState,
): BeatNote[] {
  const beatInterval = 60 / bpm;
  const highTempo = bpm >= 150;

  const holdWindows: HoldWindow[] = [];

  // Keep pattern variety even in fallback mode, but scale it down for fairness.
  const fallbackScale = usedFallback ? 0.65 : 1;
  const allowSpecials = true;
  const allowHolds = true;

  const desiredHoldFraction = (highTempo ? 0.2 : 0.28) * fallbackScale;
  const minimumHolds = filteredBeats.length >= 12 ? 1 : 0;
  const maxHolds = allowHolds
    ? Math.max(minimumHolds, Math.floor(filteredBeats.length * desiredHoldFraction))
    : 0;

  const desiredSwitchFraction = (highTempo ? 0.1 : 0.14) * fallbackScale;
  const minimumSwitches = filteredBeats.length >= 10 ? 1 : 0;
  const maxSwitches = allowSpecials
    ? Math.max(minimumSwitches, Math.floor(filteredBeats.length * desiredSwitchFraction))
    : 0;

  let holdsCreated = 0;
  let switchesCreated = 0;

  let occupiedUntil = -Infinity;

  let prevLane: LaneIndex = 1;
  let repeatCount = 0;
  let lastNoteTime = -Infinity;

  const recentWindowSec = highTempo ? 1.8 : 2.0;
  const maxActionsPerWindow = highTempo ? 8 : 7;
  const maxSpecialsPerWindow = highTempo ? 2 : 3;
  const recentActionTimes: number[] = [];
  const recentSpecialTimes: number[] = [];
  const trimRecent = (times: number[], time: number) => {
    while (times.length > 0 && times[0]! < time - recentWindowSec) {
      times.shift();
    }
  };
  const canPlaceAction = (time: number) => {
    trimRecent(recentActionTimes, time);
    return recentActionTimes.length < maxActionsPerWindow;
  };
  const canPlaceSpecial = (time: number) => {
    trimRecent(recentSpecialTimes, time);
    return recentSpecialTimes.length < maxSpecialsPerWindow;
  };
  const registerPlacedNote = (time: number, isSpecial: boolean) => {
    trimRecent(recentActionTimes, time);
    recentActionTimes.push(time);
    if (isSpecial) {
      trimRecent(recentSpecialTimes, time);
      recentSpecialTimes.push(time);
    }
  };

  const baseNotes: Array<{
    beat: BeatWithContext;
    note: Omit<BeatNote, 'id'>;
  }> = [];

  for (let i = 0; i < filteredBeats.length; i++) {
    const beat = filteredBeats[i];

    if (beat.time < occupiedUntil) {
      recordDrop(debugState, 'blocked_by_hold_occupancy', beat.time);
      continue;
    }
    if (!canPlaceAction(beat.time)) {
      recordDrop(debugState, 'blocked_by_density_cap', beat.time);
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
    const sustainThreshold = beat.isHighIntensity ? 0.45 : 0.5;
    const nextBeatTime = filteredBeats[i + 1]?.time;
    const upcomingGap = nextBeatTime !== undefined ? nextBeatTime - beat.time : Infinity;
    const hasNearbyContinuation = nextBeatTime !== undefined && upcomingGap <= beatInterval * 3.25;
    const canUseHoldSpecial = canPlaceSpecial(beat.time);

    // --- HOLD (osu-like slider) ---
    // We intentionally place holds as a pattern type, not as a "gap filler".
    // Holds are only placed when the sustain signal suggests the audio is stable.
    if (
      allowHolds &&
      holdsCreated < maxHolds &&
      !beat.isBass &&
      hasNearbyContinuation &&
      canUseHoldSpecial &&
      sustain >= sustainThreshold &&
      gapFromPrev >= beatInterval * (beat.isHighIntensity ? 0.32 : 0.4) &&
      !isNearHoldBlock(beat.time, holdWindows)
    ) {
      const lengthBeats = pickHoldLengthBeats({
        beatInterval,
        sustain,
        isHighIntensity: beat.isHighIntensity,
        seed: beatIndex,
      });

      const maxHoldSeconds = beat.isHighIntensity
        ? Math.min(1.1, beatInterval * 2.25)
        : Math.min(1.8, beatInterval * 3.0);
      const targetEndTime = beat.time + Math.min(lengthBeats * beatInterval, maxHoldSeconds);

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

        const postHoldRecoverySec = highTempo
          ? Math.max(0.14, beatInterval * 0.45)
          : Math.max(0.16, beatInterval * 0.5);
        occupiedUntil = endTime + postHoldRecoverySec;
        if (debugState?.enabled) {
          debugState.holdCoverageSec += Math.max(0, endTime - beat.time);
        }
      } else {
        recordDrop(debugState, 'hold_rejected_short_duration', beat.time);
      }
    } else if (allowHolds && holdsCreated < maxHolds) {
      if (beat.isBass) {
        recordDrop(debugState, 'hold_rejected_bass_note', beat.time);
      } else if (!hasNearbyContinuation) {
        recordDrop(debugState, 'hold_rejected_sparse_section', beat.time);
      } else if (!canUseHoldSpecial) {
        recordDrop(debugState, 'hold_rejected_special_density', beat.time);
      } else if (sustain < sustainThreshold) {
        recordDrop(debugState, 'hold_rejected_low_sustain', beat.time);
      }
    }

    // --- SWITCH ---
    const canUseSwitchSpecial = canPlaceSpecial(beat.time);
    if (
      allowSpecials &&
      type === 'normal' &&
      switchesCreated < maxSwitches &&
      beat.isHighIntensity &&
      canUseSwitchSpecial &&
      gapFromPrev >= beatInterval * 0.5 &&
      upcomingGap >= beatInterval * 0.45 &&
      !isNearHoldBlock(beat.time, holdWindows)
    ) {
      const loadFactor = recentActionTimes.length / maxActionsPerWindow;
      const baseSwitchChance = beat.isHighIntensity ? 0.5 : 0.35;
      const switchChance = clamp(baseSwitchChance - loadFactor * 0.22, 0.16, 0.52);
      const shouldMakeSwitch = pseudoRandom01(beatIndex * 19.91) < switchChance;
      const forceSwitch = repeatCount >= 3;
      const prevType = baseNotes[baseNotes.length - 1]?.note.type;
      if ((shouldMakeSwitch || forceSwitch) && prevType !== 'switch') {
        type = 'switch';
        switchFromLaneIndex = pickSwitchFromLane({
          targetLaneIndex: laneIndex,
          gapFromPrev,
          beatInterval,
          seed: beatIndex,
        });
        switchesCreated++;
      } else if (!forceSwitch) {
        recordDrop(debugState, 'switch_random_skip', beat.time);
      }
    } else if (allowSpecials && type === 'normal' && switchesCreated < maxSwitches && !canUseSwitchSpecial) {
      recordDrop(debugState, 'switch_blocked_special_density', beat.time);
    }

    baseNotes.push({
      beat,
      note: {
        time: beat.time,
        side: 'player',
        intensity: computeBaseIntensity(beat, type),
        type,
        laneIndex,
        holdEndTime,
        holdTickEveryBeats,
        switchFromLaneIndex,
      },
    });

    registerPlacedNote(beat.time, type !== 'normal');

    lastNoteTime = beat.time;

    // Holds block future notes. Normal/switch notes don’t.
    if (type === 'hold' && holdEndTime !== undefined) {
      lastNoteTime = holdEndTime;
    }
  }

  const notes: Omit<BeatNote, 'id'>[] = baseNotes.map((n) => n.note);

  // --- ECHO (double tap) ---
  if (allowSpecials) {
    const desiredEchoFraction = (usedFallback ? 0.1 : (highTempo ? 0.12 : 0.18)) * fallbackScale;
    const maxEchos = Math.floor(baseNotes.length * desiredEchoFraction);

    let echosCreated = 0;
    let lastEchoBaseIndex = -999;

    for (let i = 0; i < baseNotes.length; i++) {
      if (echosCreated >= maxEchos) break;
      if (i - lastEchoBaseIndex < 2) continue; // no consecutive echo bases

      const { beat, note } = baseNotes[i];
      if (note.type !== 'normal') continue;
      if (isNearHoldBlock(note.time, holdWindows)) {
        recordDrop(debugState, 'echo_blocked_by_hold_window', note.time);
        continue;
      }

      const strongMoment = beat.isBass || beat.energy >= beat.localAvg * 1.12;
      if (!strongMoment) {
        recordDrop(debugState, 'echo_rejected_not_strong', note.time);
        continue;
      }

      const echoDelaySec = clamp(
        beatInterval / 2,
        0.18,
        0.33,
      );

      const echoTime = note.time + echoDelaySec;

      if (!canPlaceAction(echoTime)) {
        recordDrop(debugState, 'echo_blocked_density_cap', echoTime);
        continue;
      }
      if (!canPlaceSpecial(echoTime)) {
        recordDrop(debugState, 'echo_blocked_special_density', echoTime);
        continue;
      }
      if (isNearHoldBlock(echoTime, holdWindows)) {
        recordDrop(debugState, 'echo_blocked_by_hold_window', echoTime);
        continue;
      }

      const nextBaseTime = baseNotes[i + 1]?.note.time;
      if (nextBaseTime !== undefined && echoTime > nextBaseTime - 0.12) {
        recordDrop(debugState, 'echo_blocked_by_next_note', echoTime);
        continue;
      }

      const loadFactor = recentActionTimes.length / maxActionsPerWindow;
      const baseEchoChance = beat.isHighIntensity ? 0.42 : 0.34;
      const echoChance = clamp(baseEchoChance - loadFactor * 0.12, 0.14, 0.5);
      const shouldCreateEcho = pseudoRandom01(beat.time * 123.45) < echoChance;
      if (!shouldCreateEcho) {
        recordDrop(debugState, 'echo_random_skip', echoTime);
        continue;
      }

      notes.push({
        time: echoTime,
        side: 'player',
        intensity: clamp(note.intensity - (beat.isHighIntensity ? 0.08 : 0.12), 0.45, 0.8),
        type: 'echo',
        laneIndex: note.laneIndex,
      });

      registerPlacedNote(echoTime, true);
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

function reinforceBeatContinuity(beats: DetectedBeat[], bpm: number): ReinforcedBeatResult {
  if (beats.length < 2) {
    return {
      beats,
      insertedCount: 0,
    };
  }

  const sorted = [...beats].sort((a, b) => a.time - b.time);
  const beatInterval = 60 / bpm;
  const highTempo = bpm >= 150;
  const maxGapBeforeBackfill = highTempo
    ? clamp(beatInterval * 1.85, 0.55, 0.85)
    : clamp(beatInterval * 3.2, 0.95, 2.2);
  const desiredSpacing = highTempo
    ? beatInterval * 1.35
    : beatInterval * 2.1;
  const minSurroundingEnergy = highTempo ? 0.02 : 0.06;
  let insertedCount = 0;

  const expanded: DetectedBeat[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    expanded.push(current);

    const gap = next.time - current.time;
    if (gap <= maxGapBeforeBackfill) continue;

    const surroundingEnergy = (current.energy + next.energy) / 2;
    if (surroundingEnergy < minSurroundingEnergy) continue;

    const targetInsertions = Math.min(
      highTempo ? 14 : 10,
      Math.max(1, Math.ceil(gap / desiredSpacing) - 1),
    );
    const step = gap / (targetInsertions + 1);

    for (let k = 1; k <= targetInsertions; k++) {
      const time = current.time + step * k;
      const patternBoost = highTempo
        ? (k % 4 === 0 ? 0.2 : (k % 2 === 0 ? 0.1 : 0.04))
        : (k % 4 === 0 ? 0.14 : (k % 2 === 0 ? 0.06 : 0));
      const isBass = highTempo
        ? (k % 2 === 0 || current.isBass || next.isBass)
        : (k % 4 === 0 || (current.isBass && k % 2 === 0));

      expanded.push({
        time,
        energy: clamp(surroundingEnergy + patternBoost, 0.08, 1),
        isBass,
        sustain: clamp(((current.sustain ?? 0.4) + (next.sustain ?? 0.4)) / 2, 0, 1),
      });
      insertedCount++;
    }
  }
  expanded.push(sorted[sorted.length - 1]);

  // Keep strongest beat when two are almost identical in time.
  expanded.sort((a, b) => a.time - b.time);
  const deduped: DetectedBeat[] = [];
  const dedupeThreshold = Math.max(0.06, beatInterval * 0.2);

  for (const beat of expanded) {
    const prev = deduped[deduped.length - 1];
    if (!prev || beat.time - prev.time >= dedupeThreshold) {
      deduped.push(beat);
      continue;
    }

    if (beat.energy > prev.energy) {
      prev.time = beat.time;
      prev.energy = beat.energy;
      prev.isBass = prev.isBass || beat.isBass;
      prev.sustain = beat.sustain ?? prev.sustain;
    } else if (beat.isBass) {
      prev.isBass = true;
    }
  }

  return {
    beats: deduped,
    insertedCount,
  };
}

function createGenerationDebugState(enabled: boolean): GenerationDebugState {
  return {
    enabled,
    dropReasons: {},
    dropEvents: [],
    holdCoverageSec: 0,
    backfilledBeats: 0,
  };
}

function recordDrop(state: GenerationDebugState | undefined, reason: string, timeSec: number): void {
  if (state === undefined || !state.enabled) return;

  state.dropReasons[reason] = (state.dropReasons[reason] ?? 0) + 1;
  state.dropEvents.push({
    timeSec: Math.max(0, timeSec),
    reason,
  });
}

function buildBeatmapDebugReport(input: {
  analysis: BeatAnalysis;
  bpm: number;
  duration: number;
  usedFallback: boolean;
  stabilizedBeatsCount: number;
  filteredBeatsCount: number;
  notes: BeatNote[];
  debugState: GenerationDebugState;
}): BeatmapDebugReport {
  const {
    analysis,
    bpm,
    duration,
    usedFallback,
    stabilizedBeatsCount,
    filteredBeatsCount,
    notes,
    debugState,
  } = input;

  const detectorStageCounts = analysis.debug?.detector.stageCounts ?? {
    energyBeats: 0,
    bassBeats: 0,
    rawMergedBeats: analysis.beats.length,
    gridBeats: analysis.beats.length,
    finalDetectedBeats: analysis.beats.length,
  };

  const windows = buildDebugWindows({
    notes,
    duration,
    bpm,
    dropEvents: debugState.dropEvents,
    binSizeSec: DEBUG_BIN_SIZE_SEC,
  });
  const worstWindows = [...windows].sort((a, b) => b.score - a.score).slice(0, 5);

  const noteTypeCounts = countNoteTypes(notes);
  const largestFinalGapSec = calculateLargestGapFromNotes(notes, duration);

  const alerts = buildDebugAlerts({
    windows,
    bpm,
    duration,
    usedFallback,
    debugState,
    largestFinalGapSec,
  });

  const fallbackTag = usedFallback ? 'fallback' : 'detected';
  const songFingerprint = `${duration.toFixed(1)}s-${Math.round(bpm)}bpm-${detectorStageCounts.rawMergedBeats}raw-${notes.length}notes-${fallbackTag}`;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    durationSec: duration,
    bpm,
    usedFallback,
    songFingerprint,
    binSizeSec: DEBUG_BIN_SIZE_SEC,
    stageCounts: {
      detector: detectorStageCounts,
      continuityBeats: stabilizedBeatsCount,
      filteredBeats: filteredBeatsCount,
      finalNotes: notes.length,
      holdNotes: noteTypeCounts.hold,
      switchNotes: noteTypeCounts.switch,
      echoNotes: noteTypeCounts.echo,
    },
    holdCoverageSec: Number(debugState.holdCoverageSec.toFixed(3)),
    largestFinalGapSec: Number(largestFinalGapSec.toFixed(3)),
    dropReasons: debugState.dropReasons,
    alerts,
    windows,
    worstWindows,
  };
}

function buildDebugWindows(input: {
  notes: BeatNote[];
  duration: number;
  bpm: number;
  dropEvents: BeatDropEvent[];
  binSizeSec: number;
}): BeatmapDebugWindow[] {
  const { notes, duration, bpm, dropEvents, binSizeSec } = input;

  const effectiveDuration = Math.max(
    duration,
    notes.length > 0 ? notes[notes.length - 1]!.time : 0,
  );
  const totalWindows = Math.max(1, Math.ceil(Math.max(effectiveDuration, binSizeSec) / binSizeSec));
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
  const sortedDrops = [...dropEvents].sort((a, b) => a.timeSec - b.timeSec);

  const windows: BeatmapDebugWindow[] = [];
  let noteCursor = 0;
  let dropCursor = 0;

  const targetNotesPerSecond = bpm >= 150 ? 2.4 : (bpm >= 120 ? 1.8 : 1.2);

  for (let i = 0; i < totalWindows; i++) {
    const startSec = i * binSizeSec;
    const endSec = Math.min(effectiveDuration, startSec + binSizeSec);
    const isLastWindow = i === totalWindows - 1;

    const windowNotes: BeatNote[] = [];
    while (noteCursor < sortedNotes.length) {
      const note = sortedNotes[noteCursor]!;
      const isInsideWindow = note.time < endSec || (isLastWindow && note.time <= endSec);
      if (!isInsideWindow) break;

      if (note.time >= startSec) {
        windowNotes.push(note);
      }
      noteCursor++;
    }

    const dropReasons: Record<string, number> = {};
    while (dropCursor < sortedDrops.length) {
      const drop = sortedDrops[dropCursor]!;
      const isInsideWindow = drop.timeSec < endSec || (isLastWindow && drop.timeSec <= endSec);
      if (!isInsideWindow) break;

      if (drop.timeSec >= startSec) {
        dropReasons[drop.reason] = (dropReasons[drop.reason] ?? 0) + 1;
      }
      dropCursor++;
    }

    const noteTypeCounts = createEmptyNoteTypeCounts();
    const laneCounts = {
      left: 0,
      center: 0,
      right: 0,
    };

    let longestSameLaneStreak = 0;
    let currentLaneStreak = 0;
    let previousLane: LaneIndex | null = null;

    for (const note of windowNotes) {
      noteTypeCounts[note.type] += 1;
      if (note.laneIndex === 0) laneCounts.left += 1;
      if (note.laneIndex === 1) laneCounts.center += 1;
      if (note.laneIndex === 2) laneCounts.right += 1;

      if (previousLane === note.laneIndex) {
        currentLaneStreak += 1;
      } else {
        currentLaneStreak = 1;
        previousLane = note.laneIndex;
      }
      if (currentLaneStreak > longestSameLaneStreak) {
        longestSameLaneStreak = currentLaneStreak;
      }
    }

    const noteTimes = windowNotes.map((note) => note.time);
    const { maxGapSec, avgGapSec } = calculateWindowGapStats(noteTimes, startSec, endSec);

    const windowDuration = Math.max(0.001, endSec - startSec);
    const notesPerSecond = windowNotes.length / windowDuration;
    const laneEntropy = calculateNormalizedEntropy([laneCounts.left, laneCounts.center, laneCounts.right]);
    const typeEntropy = calculateNormalizedEntropy([
      noteTypeCounts.normal,
      noteTypeCounts.hold,
      noteTypeCounts.switch,
      noteTypeCounts.echo,
    ]);

    const silentPenalty = windowNotes.length === 0 ? 4 : 0;
    const sparsePenalty = Math.max(0, targetNotesPerSecond - notesPerSecond);
    const varietyPenalty = (1 - laneEntropy) * 1.2 + (1 - typeEntropy);
    const gapPenalty = maxGapSec * 1.4;
    const streakPenalty = longestSameLaneStreak >= 6 ? (longestSameLaneStreak - 5) * 0.2 : 0;
    const dropPenalty = Math.min(2.5, Object.keys(dropReasons).length * 0.2);
    const score = silentPenalty + sparsePenalty + varietyPenalty + gapPenalty + streakPenalty + dropPenalty;

    windows.push({
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      notes: windowNotes.length,
      notesPerSecond: Number(notesPerSecond.toFixed(3)),
      maxGapSec: Number(maxGapSec.toFixed(3)),
      avgGapSec: Number(avgGapSec.toFixed(3)),
      laneCounts,
      noteTypeCounts,
      laneEntropy: Number(laneEntropy.toFixed(3)),
      typeEntropy: Number(typeEntropy.toFixed(3)),
      longestSameLaneStreak,
      dropReasons,
      score: Number(score.toFixed(3)),
    });
  }

  return windows;
}

function buildDebugAlerts(input: {
  windows: BeatmapDebugWindow[];
  bpm: number;
  duration: number;
  usedFallback: boolean;
  debugState: GenerationDebugState;
  largestFinalGapSec: number;
}): string[] {
  const { windows, bpm, duration, usedFallback, debugState, largestFinalGapSec } = input;
  const alerts: string[] = [];

  if (usedFallback) {
    alerts.push('Fallback mode enabled. Detection confidence was low in at least one stage.');
  }
  if (debugState.backfilledBeats > 0) {
    alerts.push(`Backfilled ${debugState.backfilledBeats} beats to prevent long dead zones.`);
  }

  const deadWindows = windows.filter((windowInfo) => windowInfo.notes === 0).slice(0, 3);
  for (const deadWindow of deadWindows) {
    alerts.push(
      `Dead zone: ${deadWindow.startSec.toFixed(1)}s-${deadWindow.endSec.toFixed(1)}s has zero notes.`,
    );
  }

  const largeGapThreshold = Math.max(0.95, (60 / Math.max(1, bpm)) * 3.6);
  const gapWindows = windows
    .filter((windowInfo) => windowInfo.maxGapSec >= largeGapThreshold)
    .slice(0, 3);
  for (const gapWindow of gapWindows) {
    alerts.push(
      `Large gap: ${gapWindow.startSec.toFixed(1)}s-${gapWindow.endSec.toFixed(1)}s reached ${gapWindow.maxGapSec.toFixed(2)}s.`,
    );
  }

  const repetitiveWindows = windows
    .filter((windowInfo) => windowInfo.longestSameLaneStreak >= 8 || windowInfo.laneEntropy < 0.25)
    .slice(0, 2);
  for (const repetitiveWindow of repetitiveWindows) {
    alerts.push(
      `Repetition risk: ${repetitiveWindow.startSec.toFixed(1)}s-${repetitiveWindow.endSec.toFixed(1)}s has weak lane variety.`,
    );
  }

  if (duration > 0 && debugState.holdCoverageSec > duration * 0.35) {
    alerts.push(
      `Hold saturation: holds occupy ${((debugState.holdCoverageSec / duration) * 100).toFixed(1)}% of the song.`,
    );
  }
  if (largestFinalGapSec >= 1.5) {
    alerts.push(`Largest final note gap is ${largestFinalGapSec.toFixed(2)}s.`);
  }

  return alerts.slice(0, 12);
}

function createEmptyNoteTypeCounts(): Record<NoteType, number> {
  return {
    normal: 0,
    hold: 0,
    switch: 0,
    echo: 0,
  };
}

function countNoteTypes(notes: BeatNote[]): Record<NoteType, number> {
  const counts = createEmptyNoteTypeCounts();
  for (const note of notes) {
    counts[note.type] += 1;
  }
  return counts;
}

function calculateWindowGapStats(noteTimes: number[], startSec: number, endSec: number): { maxGapSec: number; avgGapSec: number } {
  const windowDuration = Math.max(0, endSec - startSec);
  if (noteTimes.length === 0) {
    return {
      maxGapSec: windowDuration,
      avgGapSec: windowDuration,
    };
  }

  const gaps: number[] = [];
  let previousTime = startSec;
  for (const noteTime of noteTimes) {
    gaps.push(Math.max(0, noteTime - previousTime));
    previousTime = noteTime;
  }
  gaps.push(Math.max(0, endSec - previousTime));

  const maxGapSec = gaps.reduce((max, gap) => (gap > max ? gap : max), 0);
  const avgGapSec = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  return {
    maxGapSec,
    avgGapSec,
  };
}

function calculateNormalizedEntropy(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  let entropy = 0;
  for (const value of values) {
    if (value <= 0) continue;
    const probability = value / total;
    entropy -= probability * Math.log2(probability);
  }

  const maxEntropy = Math.log2(values.length);
  if (maxEntropy <= 0) return 0;
  return entropy / maxEntropy;
}

function calculateLargestGapFromNotes(notes: BeatNote[], duration: number): number {
  if (duration <= 0) return 0;
  if (notes.length === 0) return duration;

  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
  let largestGap = Math.max(0, sortedNotes[0]!.time);

  for (let i = 1; i < sortedNotes.length; i++) {
    const gap = sortedNotes[i]!.time - sortedNotes[i - 1]!.time;
    if (gap > largestGap) largestGap = gap;
  }

  const trailingGap = duration - sortedNotes[sortedNotes.length - 1]!.time;
  if (trailingGap > largestGap) largestGap = trailingGap;

  return Math.max(0, largestGap);
}

function computeBaseIntensity(beat: BeatWithContext, type: NoteType): number {
  const localBaseline = beat.localAvg > 1e-6 ? beat.localAvg : beat.energy;
  const relativeEnergy = localBaseline > 1e-6 ? beat.energy / localBaseline : 1;

  let intensity = 0.62 + (relativeEnergy - 1) * 0.28;
  if (beat.isBass) intensity += 0.08;
  if (beat.isHighIntensity) intensity += 0.05;
  if (type === 'switch') intensity += 0.08;
  if (type === 'hold') intensity += 0.04;

  return clamp(intensity, 0.48, 1.0);
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
