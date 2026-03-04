import express from 'express';

import { getMonitoringSnapshot } from '../monitoring/metrics.js';

function getMonitorToken(): string | null {
  const configuredToken = process.env.MONITOR_TOKEN?.trim();
  return configuredToken || null;
}

function hasValidMonitorToken(requestToken: string | undefined, configuredToken: string): boolean {
  return typeof requestToken === 'string' && requestToken.trim() === configuredToken;
}

export const monitorRouter = express.Router();

monitorRouter.get('/', (req, res) => {
  const monitorToken = getMonitorToken();
  if (!monitorToken) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!hasValidMonitorToken(req.header('x-monitor-token'), monitorToken)) {
    return res.status(401).json({ error: 'Invalid monitor token' });
  }

  res.json(getMonitoringSnapshot());
});
