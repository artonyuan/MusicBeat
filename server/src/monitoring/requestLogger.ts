import { nanoid } from 'nanoid';

import type { RequestHandler } from 'express';

import { recordRequestMetrics } from './metrics.js';

function parseBoolean(rawValue: string | undefined, fallbackValue: boolean): boolean {
  if (!rawValue || !rawValue.trim()) {
    return fallbackValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === 'true') return true;
  if (normalizedValue === 'false') return false;
  return fallbackValue;
}

const LOG_REQUESTS = parseBoolean(process.env.LOG_REQUESTS, process.env.NODE_ENV !== 'test');
const LOG_HEALTH_REQUESTS = parseBoolean(process.env.LOG_HEALTH_REQUESTS, false);

function getRequestPath(originalUrl: string): string {
  const [path] = originalUrl.split('?');
  return path || '/';
}

function shouldSkipLog(path: string): boolean {
  return path === '/api/health' && !LOG_HEALTH_REQUESTS;
}

function getClientIp(ip: string | undefined, fallbackAddress: string | undefined): string {
  if (ip && ip.trim()) return ip;
  if (fallbackAddress && fallbackAddress.trim()) return fallbackAddress;
  return 'unknown';
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const requestPath = getRequestPath(req.originalUrl);
  const requestId = req.header('x-request-id')?.trim() || nanoid(10);

  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const roundedDurationMs = Math.round(durationMs * 10) / 10;
    const clientIp = getClientIp(req.ip, req.socket.remoteAddress);

    recordRequestMetrics({
      durationMs: roundedDurationMs,
      ip: clientIp,
      method: req.method,
      path: requestPath,
      statusCode: res.statusCode,
    });

    if (!LOG_REQUESTS || shouldSkipLog(requestPath)) {
      return;
    }

    const logPayload = {
      at: new Date().toISOString(),
      durationMs: roundedDurationMs,
      id: requestId,
      ip: clientIp,
      method: req.method,
      path: requestPath,
      rateLimitRemaining: res.getHeader('ratelimit-remaining'),
      status: res.statusCode,
      userAgent: req.get('user-agent') ?? 'unknown',
    };

    console.log(JSON.stringify(logPayload));
  });

  next();
};
