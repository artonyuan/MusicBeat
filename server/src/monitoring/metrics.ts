interface RequestMetricInput {
  durationMs: number;
  ip: string;
  method: string;
  path: string;
  statusCode: number;
}

interface RequestMetricSample {
  durationMs: number;
  ip: string;
  method: string;
  path: string;
  statusCode: number;
  timestamp: number;
}

const SERVER_STARTED_AT = Date.now();
const RETENTION_WINDOW_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

let totalRequests = 0;
const methodCounts: Record<string, number> = {};
const pathCounts: Record<string, number> = {};
const statusCounts: Record<string, number> = {};
const recentRequests: RequestMetricSample[] = [];

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function round(value: number, decimals: number = 1): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function normalizePath(rawPath: string): string {
  const [pathname] = rawPath.split('?');
  if (!pathname) return '/';

  const segments = pathname.split('/').map((segment) => {
    if (!segment) return segment;

    const likelyId = segment.length >= 8 && /^[A-Za-z0-9_-]+$/.test(segment);
    return likelyId ? ':id' : segment;
  });

  return segments.join('/') || '/';
}

function pruneRecentRequests(now: number): void {
  const minTimestamp = now - RETENTION_WINDOW_MS;
  while (recentRequests.length > 0 && recentRequests[0].timestamp < minTimestamp) {
    recentRequests.shift();
  }
}

function percentile(values: number[], percent: number): number {
  if (values.length === 0) return 0;

  const sortedValues = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percent / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function getTopEntries(counter: Record<string, number>, limit: number): Array<{ key: string; count: number }> {
  return Object.entries(counter)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function getRequestsInLastMinute(now: number): RequestMetricSample[] {
  const minTimestamp = now - ONE_MINUTE_MS;
  return recentRequests.filter((request) => request.timestamp >= minTimestamp);
}

function getStatusCounts(samples: RequestMetricSample[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const sample of samples) {
    const bucket = `${Math.floor(sample.statusCode / 100)}xx`;
    incrementCounter(counts, bucket);
  }

  return counts;
}

function getTrafficTempo(requestsPerMinute: number): 'idle' | 'warmup' | 'grooving' | 'high_tempo' | 'mosh_pit' {
  if (requestsPerMinute === 0) return 'idle';
  if (requestsPerMinute < 30) return 'warmup';
  if (requestsPerMinute < 120) return 'grooving';
  if (requestsPerMinute < 300) return 'high_tempo';
  return 'mosh_pit';
}

function getGrooveState(errorRate: number, p95LatencyMs: number): 'locked_in' | 'steady' | 'lagging' | 'off_beat' {
  if (errorRate >= 0.1) return 'off_beat';
  if (p95LatencyMs > 800) return 'lagging';
  if (p95LatencyMs > 300) return 'steady';
  return 'locked_in';
}

export function recordRequestMetrics(input: RequestMetricInput): void {
  const now = Date.now();
  const method = input.method.toUpperCase();
  const path = normalizePath(input.path);
  const statusBucket = `${Math.floor(input.statusCode / 100)}xx`;

  totalRequests += 1;
  incrementCounter(methodCounts, method);
  incrementCounter(pathCounts, path);
  incrementCounter(statusCounts, statusBucket);
  recentRequests.push({
    durationMs: input.durationMs,
    ip: input.ip,
    method,
    path,
    statusCode: input.statusCode,
    timestamp: now,
  });

  pruneRecentRequests(now);
}

export function getHealthStatusSnapshot(): {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
  requestsPerMinute: number;
  grooveState: 'locked_in' | 'steady' | 'lagging' | 'off_beat';
} {
  const now = Date.now();
  pruneRecentRequests(now);

  const recent = getRequestsInLastMinute(now);
  const durations = recent.map((sample) => sample.durationMs);
  const p95LatencyMs = percentile(durations, 95);
  const serverErrors = recent.filter((sample) => sample.statusCode >= 500).length;
  const errorRate = recent.length > 0 ? serverErrors / recent.length : 0;

  return {
    status: 'ok',
    timestamp: new Date(now).toISOString(),
    uptimeSeconds: Math.floor((now - SERVER_STARTED_AT) / 1000),
    requestsPerMinute: recent.length,
    grooveState: getGrooveState(errorRate, p95LatencyMs),
  };
}

export function getMonitoringSnapshot() {
  const now = Date.now();
  pruneRecentRequests(now);

  const recent = getRequestsInLastMinute(now);
  const durations = recent.map((sample) => sample.durationMs);
  const p95LatencyMs = percentile(durations, 95);
  const avgLatencyMs = durations.length > 0
    ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    : 0;
  const serverErrors = recent.filter((sample) => sample.statusCode >= 500).length;
  const clientErrors = recent.filter((sample) => sample.statusCode >= 400 && sample.statusCode < 500).length;
  const errorRate = recent.length > 0 ? (serverErrors + clientErrors) / recent.length : 0;

  const runSavesLastMinute = recent.filter(
    (sample) => sample.method === 'POST' && sample.path === '/api/run' && sample.statusCode < 400
  ).length;
  const uploadsAcceptedLastMinute = recent.filter(
    (sample) => sample.method === 'POST' && sample.path === '/api/upload' && sample.statusCode < 400
  ).length;
  const sessionsIssuedLastMinute = recent.filter(
    (sample) => sample.method === 'POST' && sample.path === '/api/session/anonymous' && sample.statusCode < 400
  ).length;

  const hypeScoreRaw = 100 - (errorRate * 180) - (p95LatencyMs / 10) + Math.min(recent.length, 120) / 3;
  const hypeScore = Math.max(0, Math.min(100, round(hypeScoreRaw, 0)));
  const grooveState = getGrooveState(errorRate, p95LatencyMs);

  return {
    generatedAt: new Date(now).toISOString(),
    uptimeSeconds: Math.floor((now - SERVER_STARTED_AT) / 1000),
    process: {
      pid: process.pid,
      memoryRssMb: round(process.memoryUsage().rss / (1024 * 1024), 1),
      memoryHeapUsedMb: round(process.memoryUsage().heapUsed / (1024 * 1024), 1),
    },
    requests: {
      total: totalRequests,
      inLastMinute: recent.length,
      uniqueIpsLastMinute: new Set(recent.map((sample) => sample.ip)).size,
      avgLatencyMs: round(avgLatencyMs, 1),
      p95LatencyMs: round(p95LatencyMs, 1),
      statusTotals: statusCounts,
      statusLastMinute: getStatusCounts(recent),
      topPaths: getTopEntries(pathCounts, 8),
      methods: methodCounts,
    },
    rhythm: {
      runSavesLastMinute,
      uploadsAcceptedLastMinute,
      sessionsIssuedLastMinute,
      trafficTempo: getTrafficTempo(recent.length),
      grooveState,
      hypeScore,
    },
  };
}
