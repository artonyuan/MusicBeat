import express from 'express';
import { nanoid } from 'nanoid';
import { saveBeatmap, getBeatmap, incrementPlayCount, getRecentBeatmaps } from '../db/schema.js';

export const beatmapRouter = express.Router();

// Save a new beatmap
beatmapRouter.post('/', (req, res) => {
  try {
    const { title, duration, bpm, difficulty, audioFilename, notes } = req.body;

    if (!title || !duration || !bpm || !audioFilename || !notes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = nanoid(10);

    saveBeatmap({
      id,
      title,
      duration,
      bpm,
      difficulty: difficulty || 'normal',
      audio_filename: audioFilename,
      notes_json: JSON.stringify(notes),
    });

    // Generate shareable URL
    const shareUrl = `/play/${id}`;

    res.json({
      success: true,
      id,
      shareUrl,
    });
  } catch (error) {
    console.error('Save beatmap error:', error);
    res.status(500).json({ error: 'Failed to save beatmap' });
  }
});

// Get beatmap by ID
beatmapRouter.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const beatmap = getBeatmap(id);

    if (!beatmap) {
      return res.status(404).json({ error: 'Beatmap not found' });
    }

    // Increment play count
    incrementPlayCount(id);

    // Parse notes from JSON
    const notes = JSON.parse(beatmap.notes_json);

    res.json({
      id: beatmap.id,
      title: beatmap.title,
      duration: beatmap.duration,
      bpm: beatmap.bpm,
      difficulty: beatmap.difficulty,
      audioUrl: `/uploads/${beatmap.audio_filename}`,
      notes,
      playCount: beatmap.play_count + 1,
      createdAt: beatmap.created_at,
    });
  } catch (error) {
    console.error('Get beatmap error:', error);
    res.status(500).json({ error: 'Failed to get beatmap' });
  }
});

// Get recent/popular beatmaps
beatmapRouter.get('/', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const beatmaps = getRecentBeatmaps(limit);

    const formatted = beatmaps.map((b) => ({
      id: b.id,
      title: b.title,
      duration: b.duration,
      bpm: b.bpm,
      difficulty: b.difficulty,
      playCount: b.play_count,
      createdAt: b.created_at,
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get beatmaps error:', error);
    res.status(500).json({ error: 'Failed to get beatmaps' });
  }
});
