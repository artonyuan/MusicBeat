import { isBeatmapDebugEnabled } from '../beatmap/beatmapDebug';

import type { BeatAnalysis, BeatDetectorDebug, DetectedBeat } from '../types/beatmap';

export async function analyzeBeatmap(audioBuffer: AudioBuffer): Promise<BeatAnalysis> {
  const debugEnabled = isBeatmapDebugEnabled();
  const monoData = mixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;

  // 1. Detect BPM
  const bpm = await detectBPM(monoData, sampleRate);

  // 2. Detect raw beat onsets using multiple methods
  const energyBeats = detectBeatsEnergy(monoData, sampleRate);
  const bassBeats = detectBassBeats(monoData, sampleRate);

  // Merge and deduplicate
  const rawBeats = mergeBeats([...energyBeats, ...bassBeats], 0.05);

  // 3. Find the "Offset" (The timestamp of the first strong beat)
  const offset = findBeatOffset(rawBeats, bpm);

  // 4. Generate a clean grid based on BPM + Offset
  const gridBeats = generateRhythmicGrid(rawBeats, bpm, offset, audioBuffer.duration);
  let beats = gridBeats;

  // 5. Fallback only when both grid output and raw detections are very sparse.
  // This keeps nuanced detection data for energetic tracks instead of flattening them.
  const expectedBeats = Math.floor((audioBuffer.duration * bpm) / 60);
  const minimumDetectedBeats = Math.max(12, Math.floor(expectedBeats * 0.12));
  const minimumRawBeats = Math.max(8, Math.floor(expectedBeats * 0.08));
  let usedFallback = false;
  let fallbackReason: BeatDetectorDebug['fallbackReason'];
  if (
    beats.length === 0 ||
    (beats.length < minimumDetectedBeats && rawBeats.length < minimumRawBeats)
  ) {
    fallbackReason = beats.length === 0 ? 'empty_grid' : 'sparse_grid_and_raw';
    beats = generateRegularGrid(bpm, offset, audioBuffer.duration);
    usedFallback = true;
  }

  // Enrich beats with a lightweight sustain score for hold/slider placement.
  // (Even if fallback triggers, this is harmless; generator can decide to ignore it.)
  enrichBeatsWithSustain(beats, monoData, sampleRate);

  return {
    bpm,
    beats,
    duration: audioBuffer.duration,
    usedFallback,
    debug: debugEnabled
      ? {
        enabled: true,
        detector: {
          sampleRate,
          offsetSec: offset,
          expectedBeats,
          minimumDetectedBeats,
          minimumRawBeats,
          fallbackReason,
          largestRawGapSec: calculateLargestGapSec(rawBeats, audioBuffer.duration),
          largestGridGapSec: calculateLargestGapSec(gridBeats, audioBuffer.duration),
          stageCounts: {
            energyBeats: energyBeats.length,
            bassBeats: bassBeats.length,
            rawMergedBeats: rawBeats.length,
            gridBeats: gridBeats.length,
            finalDetectedBeats: beats.length,
          },
        },
      }
      : undefined,
  };
}

/**
 * Fallback: Generate a regular grid of beats without energy detection
 */
function generateRegularGrid(bpm: number, offset: number, duration: number): DetectedBeat[] {
  const beats: DetectedBeat[] = [];
  const beatInterval = 60 / bpm;
  let beatIndex = 0;

  for (let t = offset; t < duration; t += beatInterval) {
    const measurePosition = beatIndex % 4;
    const phrasePosition = beatIndex % 16;
    const phraseLift = phrasePosition >= 12 ? 0.08 : 0;

    let energy = 0.58 + phraseLift;
    if (measurePosition === 0) {
      energy = 0.9 + phraseLift;
    } else if (measurePosition === 2) {
      energy = 0.72 + phraseLift;
    } else if (bpm >= 150 && measurePosition === 1) {
      energy = 0.64 + phraseLift;
    }

    beats.push({
      time: t,
      energy: clamp01(energy),
      isBass: measurePosition === 0 || (bpm >= 150 && measurePosition === 2),
    });
    beatIndex++;
  }

  return beats;
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
  return mono;
}

function enrichBeatsWithSustain(beats: DetectedBeat[], samples: Float32Array, sampleRate: number) {
  if (beats.length === 0) return;

  const { rms, hopSize } = computeRmsEnvelope(samples, sampleRate);
  if (rms.length === 0) return;

  let minRms = Infinity;
  let maxRms = -Infinity;
  for (const v of rms) {
    if (v < minRms) minRms = v;
    if (v > maxRms) maxRms = v;
  }

  const hopSec = hopSize / sampleRate;
  const windowSec = 0.25;
  const windowRadius = Math.max(1, Math.round(windowSec / hopSec));

  for (const beat of beats) {
    const centerIndex = Math.round(beat.time / hopSec);
    const start = Math.max(0, centerIndex - windowRadius);
    const end = Math.min(rms.length - 1, centerIndex + windowRadius);

    let sum = 0;
    let count = 0;
    let deltaSum = 0;
    let deltaCount = 0;

    for (let i = start; i <= end; i++) {
      const v = rms[i];
      sum += v;
      count++;

      if (i > start) {
        deltaSum += Math.abs(v - rms[i - 1]);
        deltaCount++;
      }
    }

    const mean = count > 0 ? sum / count : 0;
    const meanAbsDelta = deltaCount > 0 ? deltaSum / deltaCount : 0;

    const normalizedRms = (mean - minRms) / (maxRms - minRms + 1e-6);

    // Delta relative to loudness: lower means more "sustained".
    const deltaRatio = meanAbsDelta / (mean + 1e-6);

    // Tuned empirically: 0.0 = very stable, ~0.4+ = very transient.
    const stability = 1 - clamp01(deltaRatio / 0.4);

    beat.sustain = clamp01(normalizedRms * stability);
  }
}

function computeRmsEnvelope(samples: Float32Array, sampleRate: number): { rms: number[]; hopSize: number } {
  const hopSize = Math.floor(sampleRate / 50); // ~20ms
  const frameSize = Math.floor(sampleRate / 20); // ~50ms
  const rms: number[] = [];

  for (let i = 0; i < samples.length - frameSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      const v = samples[i + j];
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / frameSize));
  }

  return { rms, hopSize };
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function calculateLargestGapSec(beats: DetectedBeat[], duration: number): number {
  if (duration <= 0) return 0;
  if (beats.length === 0) return duration;

  let largestGap = beats[0]!.time;
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i]!.time - beats[i - 1]!.time;
    if (gap > largestGap) largestGap = gap;
  }

  const trailingGap = duration - beats[beats.length - 1]!.time;
  if (trailingGap > largestGap) largestGap = trailingGap;

  return Math.max(0, largestGap);
}

/**
 * Finds the first reliable beat to align the grid to.
 */
function findBeatOffset(rawBeats: DetectedBeat[], bpm: number): number {
  if (rawBeats.length === 0) return 0;

  // Look at the first 10 seconds only
  const earlyBeats = rawBeats.filter(b => b.time < 10.0);
  if (earlyBeats.length === 0) return rawBeats[0]?.time || 0;

  const beatInterval = 60 / bpm;

  // Simple Phase matching
  let bestOffset = 0;
  let maxConsensus = -1;

  // Check up to first 5 detected peaks to serve as the "Downbeat"
  const candidates = earlyBeats.slice(0, 5);

  for (const candidate of candidates) {
    let consensus = 0;
    // Check how many other beats fall on this candidate's grid
    for (const beat of earlyBeats) {
      const dist = Math.abs(beat.time - candidate.time);
      const cycles = Math.round(dist / beatInterval);
      const error = Math.abs(dist - (cycles * beatInterval));

      // If error is less than 15% of a beat, it fits the grid
      if (error < beatInterval * 0.15) {
        consensus++;
      }
    }

    if (consensus > maxConsensus) {
      maxConsensus = consensus;
      bestOffset = candidate.time;
    }
  }

  // Normalize offset to be as close to 0 as possible while keeping phase
  while (bestOffset >= beatInterval) {
    bestOffset -= beatInterval;
  }

  return Math.max(0, bestOffset);
}

/**
 * Generates a rhythmic grid, keeping beats that align AND off-grid beats that are strong.
 * This preserves syncopation and build-up patterns.
 */
function generateRhythmicGrid(rawBeats: DetectedBeat[], bpm: number, offset: number, duration: number): DetectedBeat[] {
  const finalBeats: DetectedBeat[] = [];
  const beatInterval = 60 / bpm;

  // Wider tolerance windows
  const mainWindow = 0.10; // 100ms for main beats
  const halfWindow = 0.08; // 80ms for half-beats
  const quarterWindow = 0.06; // 60ms for quarter-beats (16ths)

  // Calculate average energy to identify strong off-grid beats
  const avgEnergy = rawBeats.length > 0 
    ? rawBeats.reduce((sum, b) => sum + b.energy, 0) / rawBeats.length 
    : 0;
  const energyVariance = rawBeats.length > 0
    ? rawBeats.reduce((sum, beat) => {
      const delta = beat.energy - avgEnergy;
      return sum + delta * delta;
    }, 0) / rawBeats.length
    : 0;
  const energyStdDev = Math.sqrt(energyVariance);
  const quarterEnergyThreshold = avgEnergy > 0
    ? Math.max(
      avgEnergy * (bpm >= 150 ? 1.12 : 1.25),
      avgEnergy + energyStdDev * (bpm >= 150 ? 0.1 : 0.25),
    )
    : 0;

  // Track which raw beats have been used
  const usedBeats = new Set<number>();

  // Iterate through the IDEAL grid (main beats)
  for (let t = offset; t < duration; t += beatInterval) {
    // Find the strongest beat close to this grid time
    const nearbyMainBeats = rawBeats.filter((raw, idx) => 
      !usedBeats.has(idx) && Math.abs(raw.time - t) < mainWindow
    );
    
    if (nearbyMainBeats.length > 0) {
      const strongest = nearbyMainBeats.reduce((prev, current) => 
        (current.energy > prev.energy) ? current : prev
      );
      
      finalBeats.push({
        time: t,
        energy: strongest.energy,
        isBass: strongest.isBass
      });
      
      // Mark as used
      const idx = rawBeats.findIndex(b => b.time === strongest.time);
      if (idx >= 0) usedBeats.add(idx);
    }

    // Check half-beats (8th notes)
    const halfT = t + (beatInterval / 2);
    const nearbyHalfBeats = rawBeats.filter((raw, idx) => 
      !usedBeats.has(idx) && Math.abs(raw.time - halfT) < halfWindow
    );

    if (nearbyHalfBeats.length > 0) {
      const strongestHalf = nearbyHalfBeats.reduce((prev, current) => 
        (current.energy > prev.energy) ? current : prev
      );

      finalBeats.push({
        time: halfT,
        energy: strongestHalf.energy,
        isBass: strongestHalf.isBass
      });
      
      const idx = rawBeats.findIndex(b => b.time === strongestHalf.time);
      if (idx >= 0) usedBeats.add(idx);
    }

    // Check quarter-beats (16th notes) - only keep if very strong (build-ups/rolls)
    const quarters = [t + beatInterval * 0.25, t + beatInterval * 0.75];
    for (const quarterT of quarters) {
      const nearbyQuarterBeats = rawBeats.filter((raw, idx) => 
        !usedBeats.has(idx) && 
        Math.abs(raw.time - quarterT) < quarterWindow &&
        raw.energy >= quarterEnergyThreshold
      );

      if (nearbyQuarterBeats.length > 0) {
        const strongestQuarter = nearbyQuarterBeats.reduce((prev, current) => 
          (current.energy > prev.energy) ? current : prev
        );

        finalBeats.push({
          time: quarterT,
          energy: strongestQuarter.energy,
          isBass: strongestQuarter.isBass
        });
        
        const idx = rawBeats.findIndex(b => b.time === strongestQuarter.time);
        if (idx >= 0) usedBeats.add(idx);
      }
    }
  }

  const minOffGridSpacing = beatInterval * (bpm >= 150 ? 0.18 : 0.22);
  const offGridEnergyThreshold = avgEnergy > 0
    ? Math.max(
      avgEnergy * (bpm >= 150 ? 1.03 : 1.1),
      avgEnergy + energyStdDev * (bpm >= 150 ? 0.05 : 0.15),
    )
    : 0;

  // Preserve strong off-grid peaks that survived detection but didn't fit strict quantization.
  // This keeps syncopation/build-up accents in energetic genres.
  for (let i = 0; i < rawBeats.length; i++) {
    if (usedBeats.has(i)) continue;
    const candidate = rawBeats[i];
    if (candidate.energy < offGridEnergyThreshold) continue;

    const tooCloseToExisting = finalBeats.some((beat) => Math.abs(beat.time - candidate.time) < minOffGridSpacing);
    if (tooCloseToExisting) continue;

    finalBeats.push({
      time: candidate.time,
      energy: candidate.energy,
      isBass: candidate.isBass,
    });
  }

  // Sort by time
  finalBeats.sort((a, b) => a.time - b.time);

  return finalBeats;
}

// --- Simplified Standard Detection Methods ---

async function detectBPM(samples: Float32Array, sampleRate: number): Promise<number> {
  const analysisLength = Math.min(samples.length, sampleRate * 60);
  const analysisData = samples.slice(0, analysisLength);

  const hopSize = Math.floor(sampleRate / 100);
  const frameSize = Math.floor(sampleRate / 20);
  const envelope: number[] = [];

  for (let i = 0; i < analysisData.length - frameSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      energy += analysisData[i + j] * analysisData[i + j];
    }
    envelope.push(Math.sqrt(energy / frameSize));
  }

  let bestCorrelation = -1;
  let bestLag = 0;

  const minLag = Math.max(1, Math.floor((60 / 220) * (sampleRate / hopSize)));
  const maxLag = Math.floor((60 / 55) * (sampleRate / hopSize));

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    for (let i = 0; i < envelope.length - lag; i += 2) {
      correlation += envelope[i] * envelope[i + lag];
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return 120;

  const detectedBPM = 60 * (sampleRate / hopSize) / bestLag;

  if (detectedBPM < 65) return Math.round(detectedBPM * 2);

  return Math.round(detectedBPM);
}

/**
 * Merge beat arrays and remove duplicates within threshold
 */
function mergeBeats(beats: DetectedBeat[], threshold: number): DetectedBeat[] {
  if (beats.length === 0) return [];

  const sorted = [...beats].sort((a, b) => a.time - b.time);
  const merged: DetectedBeat[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.time - last.time >= threshold) {
      merged.push(current);
    } else {
      // Overlapping beats: merge properties
      // If either is bass, the merged one is bass
      // Take the max energy
      last.isBass = last.isBass || current.isBass;
      last.energy = Math.max(last.energy, current.energy);
    }
  }

  return merged;
}

/**
 * Detect beats using low-frequency energy (for 808s/bass-heavy tracks like plugg)
 */
function detectBassBeats(samples: Float32Array, sampleRate: number): DetectedBeat[] {
  const filtered = new Float32Array(samples.length);
  const cutoff = 150; 
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);

  filtered[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    filtered[i] = filtered[i - 1] + alpha * (samples[i] - filtered[i - 1]);
  }

  const hopSize = Math.floor(sampleRate / 50); 
  const frameSize = Math.floor(sampleRate / 10);
  const energies: number[] = [];

  for (let i = 0; i < filtered.length - frameSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      sum += filtered[i + j] * filtered[i + j];
    }
    energies.push(Math.sqrt(sum / frameSize));
  }

  const beats: DetectedBeat[] = [];
  const windowSize = 10;

  for (let i = windowSize; i < energies.length - windowSize; i++) {
    const current = energies[i];

    let localSum = 0;
    let localSqSum = 0;
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      const val = energies[j];
      localSum += val;
      localSqSum += val * val;
    }
    const count = windowSize * 2 + 1;
    const localAvg = localSum / count;
    const localVariance = (localSqSum / count) - (localAvg * localAvg);
    const localStdDev = Math.sqrt(Math.max(0, localVariance));

    const coefficientOfVariation = localStdDev / (localAvg + 1e-6);
    const sensitivity = clamp(1.15 + coefficientOfVariation * 1.6, 1.15, 2.0);
    const minThreshold = Math.max(0.02, localAvg * 0.28);
    const threshold = localAvg + (sensitivity * localStdDev);

    if (current > threshold && 
        current > minThreshold && 
        current > energies[i - 1] && 
        current > energies[i + 1]) {
      
      beats.push({
        time: (i * hopSize) / sampleRate,
        energy: current, // Raw energy value
        isBass: true,
      });
      i += 6;
    }
  }

  return beats;
}

function detectBeatsEnergy(samples: Float32Array, sampleRate: number): DetectedBeat[] {
  const hopSize = Math.floor(sampleRate / 100); 
  const frameSize = 1024;
  const energies: number[] = [];

  for (let i = 0; i < samples.length - frameSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      sum += samples[i + j] * samples[i + j];
    }
    energies.push(Math.sqrt(sum / frameSize));
  }

  const beats: DetectedBeat[] = [];
  const windowSize = 28;

  for (let i = windowSize; i < energies.length - windowSize; i++) {
    const current = energies[i];

    let localSum = 0;
    let localSqSum = 0;
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      const val = energies[j];
      localSum += val;
      localSqSum += val * val;
    }
    const count = windowSize * 2 + 1;
    const localAvg = localSum / count;
    const localVariance = (localSqSum / count) - (localAvg * localAvg);
    const localStdDev = Math.sqrt(Math.max(0, localVariance));

    // Adaptive threshold:
    // compressed sections (low variance) should use a lower multiplier,
    // while highly dynamic sections can keep a stricter threshold.
    const coefficientOfVariation = localStdDev / (localAvg + 1e-6);
    const sensitivity = clamp(1.2 + coefficientOfVariation * 1.4, 1.15, 2.2);
    const minThreshold = Math.max(0.015, localAvg * 0.24);
    const threshold = localAvg + (sensitivity * localStdDev);

    if (current > threshold &&
        current > minThreshold &&
        current >= energies[i-1] &&
        current > energies[i+1]) {
      
      beats.push({
        time: (i * hopSize) / sampleRate,
        energy: current,
        isBass: false,
      });

      i += 9;
    }
  }

  return beats;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
