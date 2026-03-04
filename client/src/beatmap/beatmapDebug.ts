import type { BeatmapDebugReport } from '../types/beatmap';

const DEBUG_QUERY_KEY = 'debugBeatmap';
const DEBUG_STORAGE_KEY = 'pong:debugBeatmap';
const LEGACY_DEBUG_STORAGE_KEY = 'musicbeat:debugBeatmap';

function parseBooleanFlag(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false;
  return null;
}

export function isBeatmapDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const queryValue = parseBooleanFlag(new URLSearchParams(window.location.search).get(DEBUG_QUERY_KEY));
  if (queryValue !== null) {
    try {
      window.localStorage.setItem(DEBUG_STORAGE_KEY, queryValue ? '1' : '0');
      window.localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY);
    } catch {
      // Ignore storage failures in restricted browser modes.
    }
    return queryValue;
  }

  try {
    const stored = window.localStorage.getItem(DEBUG_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_DEBUG_STORAGE_KEY);
    if (stored === '1' && window.localStorage.getItem(DEBUG_STORAGE_KEY) !== '1') {
      try {
        window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
        window.localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY);
      } catch {
        // Ignore migration write failures and use in-memory read result.
      }
    }
    return stored === '1';
  } catch {
    return false;
  }
}

export function exposeBeatmapDebug(report: BeatmapDebugReport): void {
  if (typeof window === 'undefined') return;

  window.__beatmapDebug = report;

  if (!report.enabled) return;

  const rows = report.worstWindows.map((windowInfo) => ({
    range: `${windowInfo.startSec.toFixed(1)}s-${windowInfo.endSec.toFixed(1)}s`,
    notesPerSecond: Number(windowInfo.notesPerSecond.toFixed(2)),
    maxGapSec: Number(windowInfo.maxGapSec.toFixed(3)),
    laneEntropy: Number(windowInfo.laneEntropy.toFixed(2)),
    typeEntropy: Number(windowInfo.typeEntropy.toFixed(2)),
    score: Number(windowInfo.score.toFixed(2)),
    drops: Object.keys(windowInfo.dropReasons).length,
  }));

  console.groupCollapsed(
    `[BeatmapDebug] ${report.songFingerprint} | notes=${report.stageCounts.finalNotes} | fallback=${String(report.usedFallback)}`,
  );
  console.table(rows);
  if (report.alerts.length > 0) {
    console.warn('[BeatmapDebug] Alerts:', report.alerts);
  }
  console.log('[BeatmapDebug] Drop reasons:', report.dropReasons);
  console.log('[BeatmapDebug] Full report:', report);
  console.groupEnd();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'track';
}

export function downloadBeatmapDebugReport(report: BeatmapDebugReport, songTitle: string): void {
  if (typeof window === 'undefined') return;

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  const safeTitle = slugify(songTitle);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `pong-debug-${safeTitle}-${timestamp}.json`;
  link.click();

  URL.revokeObjectURL(url);
}
