import express from 'express';
import { nanoid } from 'nanoid';

import { getRun, saveRun } from '../db/schema.js';

export const runRouter = express.Router();

runRouter.post('/', (req, res) => {
  try {
    const {
      title,
      handle,
      score,
      accuracy,
      maxCombo,
      grade,
      perfectCount,
      goodCount,
      okCount,
      missCount,
      bpm,
      duration,
      difficulty,
    } = req.body;

    const parsedScore = Number(score);
    const parsedAccuracy = Number(accuracy);
    const parsedMaxCombo = Number(maxCombo);
    const parsedPerfect = Number(perfectCount);
    const parsedGood = Number(goodCount);
    const parsedOk = Number(okCount);
    const parsedMiss = Number(missCount);
    const parsedBpm = Number(bpm);
    const parsedDuration = Number(duration);

    const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : 'Untitled Track';
    const safeHandle = typeof handle === 'string' && handle.trim() ? handle.trim() : 'player';
    const safeGrade = typeof grade === 'string' && grade.trim() ? grade.trim() : 'F';
    const safeDifficulty = typeof difficulty === 'string' && difficulty.trim() ? difficulty.trim() : 'pro';

    if (
      !Number.isFinite(parsedScore) ||
      !Number.isFinite(parsedAccuracy) ||
      !Number.isFinite(parsedMaxCombo) ||
      !Number.isFinite(parsedPerfect) ||
      !Number.isFinite(parsedGood) ||
      !Number.isFinite(parsedOk) ||
      !Number.isFinite(parsedMiss) ||
      !Number.isFinite(parsedBpm) ||
      !Number.isFinite(parsedDuration)
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = nanoid(8);

    saveRun({
      id,
      title: safeTitle,
      handle: safeHandle,
      score: parsedScore,
      accuracy: parsedAccuracy,
      max_combo: parsedMaxCombo,
      grade: safeGrade,
      perfect_count: parsedPerfect,
      good_count: parsedGood,
      ok_count: parsedOk,
      miss_count: parsedMiss,
      bpm: parsedBpm,
      duration: parsedDuration,
      difficulty: safeDifficulty,
    });

    res.json({ id });
  } catch (error) {
    console.error('Save run error:', error);
    res.status(500).json({ error: 'Failed to save run' });
  }
});

runRouter.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const run = getRun(id);

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json({
      id: run.id,
      title: run.title,
      handle: run.handle,
      score: run.score,
      accuracy: run.accuracy,
      maxCombo: run.max_combo,
      grade: run.grade,
      perfectCount: run.perfect_count,
      goodCount: run.good_count,
      okCount: run.ok_count,
      missCount: run.miss_count,
      bpm: run.bpm,
      duration: run.duration,
      difficulty: run.difficulty,
      createdAt: run.created_at,
    });
  } catch (error) {
    console.error('Get run error:', error);
    res.status(500).json({ error: 'Failed to get run' });
  }
});
