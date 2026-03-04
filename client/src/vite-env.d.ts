/// <reference types="vite/client" />

import type { BeatmapDebugReport } from './types/beatmap';

declare global {
  interface Window {
    __beatmapDebug?: BeatmapDebugReport;
  }
}
