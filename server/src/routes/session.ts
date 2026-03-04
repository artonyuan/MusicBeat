import express from 'express';

import { issueAnonymousSession } from '../auth/anonymousSession.js';

export const sessionRouter = express.Router();

sessionRouter.post('/anonymous', (req, res) => {
  try {
    const session = issueAnonymousSession();
    res.status(201).json(session);
  } catch (error) {
    console.error('Issue anonymous session error:', error);
    res.status(500).json({ error: 'Failed to create anonymous session' });
  }
});
