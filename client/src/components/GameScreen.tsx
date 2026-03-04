import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import { useGameStore } from '../store/gameStore';
import { DIFFICULTY_PRESETS } from '../types/game';
import Game from '../game/Game';
import GameHUD from './GameHUD';

import type { FailReason, RunOutcome } from '../types/game';

const FAIL_AUDIO_DURATION_MS = 1200;

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastDrainTimeRef = useRef<number>(0);
  const failTimeoutRef = useRef<number | null>(null);
  const hasFinalizedRunRef = useRef(false);
  const failSequenceStartedRef = useRef(false);
  const ignoreOnEndedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Hit sound buffer
  const hitSoundBufferRef = useRef<AudioBuffer | null>(null);

  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const beatmap = useGameStore((state) => state.beatmap);
  const phase = useGameStore((state) => state.phase);
  const setPhase = useGameStore((state) => state.setPhase);
  const setScreen = useGameStore((state) => state.setScreen);
  const resetGame = useGameStore((state) => state.resetGame);
  const difficulty = useGameStore((state) => state.difficulty);
  const volume = useGameStore((state) => state.musicVolume);
  const setMusicVolume = useGameStore((state) => state.setMusicVolume);
  const health = useGameStore((state) => state.health);
  const missStreak = useGameStore((state) => state.missStreak);
  const setRunOutcome = useGameStore((state) => state.setRunOutcome);
  const applyPassiveDrain = useGameStore((state) => state.applyPassiveDrain);
  const [showDebugOverlay, setShowDebugOverlay] = useState(true);

  const gameplaySettings = useMemo(() => DIFFICULTY_PRESETS[difficulty], [difficulty]);

  const clearFailTimeout = useCallback(() => {
    if (failTimeoutRef.current === null) return;
    window.clearTimeout(failTimeoutRef.current);
    failTimeoutRef.current = null;
  }, []);

  const closeAudio = useCallback(() => {
    try {
      sourceNodeRef.current?.stop();
    } catch (error) {
      // Ignore already-stopped sources.
    }

    try {
      audioContextRef.current?.close();
    } catch (error) {
      // Ignore already-closed contexts.
    }

    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    audioContextRef.current = null;
  }, []);

  const finalizeRun = useCallback((outcome: RunOutcome) => {
    if (hasFinalizedRunRef.current) return;

    hasFinalizedRunRef.current = true;
    setRunOutcome(outcome);
    setIsPlaying(false);
    setPhase('ended');
    closeAudio();
    setScreen('results');
  }, [closeAudio, setPhase, setRunOutcome, setScreen]);

  const triggerFail = useCallback((reason: FailReason) => {
    if (hasFinalizedRunRef.current || failSequenceStartedRef.current) return;

    failSequenceStartedRef.current = true;
    setRunOutcome(reason);
    setIsPlaying(false);
    setPhase('ended');
    clearFailTimeout();

    const audioContext = audioContextRef.current;
    const sourceNode = sourceNodeRef.current;
    const gainNode = gainNodeRef.current;

    if (!audioContext || !sourceNode || !gainNode) {
      finalizeRun(reason);
      return;
    }

    const now = audioContext.currentTime;
    const safeCurrentGain = Math.max(gainNode.gain.value, 0.0001);

    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(safeCurrentGain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + FAIL_AUDIO_DURATION_MS / 1000);

    sourceNode.playbackRate.cancelScheduledValues(now);
    sourceNode.playbackRate.setValueAtTime(Math.max(sourceNode.playbackRate.value, 0.0001), now);
    sourceNode.playbackRate.exponentialRampToValueAtTime(0.6, now + FAIL_AUDIO_DURATION_MS / 1000);

    ignoreOnEndedRef.current = true;
    failTimeoutRef.current = window.setTimeout(() => {
      finalizeRun(reason);
    }, FAIL_AUDIO_DURATION_MS);
  }, [clearFailTimeout, finalizeRun, setPhase, setRunOutcome]);

  // Initialize generated hit sound effect
  useEffect(() => {
    const generateHitSound = () => {
      const audioContext = new AudioContext();
      const duration = 0.1;
      const sampleRate = audioContext.sampleRate;
      const buffer = audioContext.createBuffer(1, duration * sampleRate, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        // Punchier kick/click sound:
        // Rapid pitch drop (150Hz -> 0Hz) + fast decay
        const freq = 150 * Math.exp(-t * 20);
        const envelope = Math.exp(-t * 50); // Fast decay
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope;
      }

      hitSoundBufferRef.current = buffer;
      audioContext.close();
    };

    generateHitSound();
  }, []);

  // Play hit sound
  const playHitSound = useCallback(() => {
    if (!hitSoundBufferRef.current || !audioContextRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = hitSoundBufferRef.current;

    const hitGain = audioContextRef.current.createGain();
    hitGain.gain.value = 0.6;

    source.connect(hitGain);
    hitGain.connect(audioContextRef.current.destination);
    source.start(0);
  }, []);

  // Handle volume change - update gain node directly
  const handleVolumeChange = useCallback((newVolume: number) => {
    setMusicVolume(newVolume);

    if (gainNodeRef.current) {
      // Direct value assignment - works immediately
      // Use small value instead of 0 to avoid clicks, but true 0 for mute
      gainNodeRef.current.gain.value = newVolume === 0 ? 0 : newVolume;
    }
  }, [setMusicVolume]);

  // Start the game audio - only call once!
  const startGame = useCallback(() => {
    // Guard: don't start if already playing
    if (!audioBuffer || audioContextRef.current) return;

    hasFinalizedRunRef.current = false;
    failSequenceStartedRef.current = false;
    ignoreOnEndedRef.current = false;
    lastDrainTimeRef.current = 0;
    clearFailTimeout();

    setRunOutcome(null);
    setCurrentTime(0);
    setCountdown(0);

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Create gain node for volume control.
    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;
    gainNodeRef.current = gainNode;

    // Create and connect source -> gain -> destination
    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    sourceNode.onended = () => {
      if (ignoreOnEndedRef.current) return;
      finalizeRun('completed');
    };

    sourceNode.start(0);
    sourceNodeRef.current = sourceNode;
    startTimeRef.current = audioContext.currentTime;
    lastDrainTimeRef.current = 0;

    setIsPlaying(true);
    setPhase('playing');
  }, [audioBuffer, clearFailTimeout, finalizeRun, setPhase, setRunOutcome, volume]);

  // Start countdown and then play
  useEffect(() => {
    if (phase !== 'countdown') return;

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          startGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [phase, startGame]);

  // Update current time
  useEffect(() => {
    if (!isPlaying || !audioContextRef.current) return;

    const updateTime = () => {
      if (audioContextRef.current) {
        const time = audioContextRef.current.currentTime - startTimeRef.current;
        setCurrentTime(time);
      }
    };

    const interval = setInterval(updateTime, 16);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Passive HP drain while gameplay is active.
  useEffect(() => {
    if (phase !== 'playing') {
      lastDrainTimeRef.current = currentTime;
      return;
    }

    const deltaSeconds = Math.max(0, currentTime - lastDrainTimeRef.current);
    lastDrainTimeRef.current = currentTime;
    if (deltaSeconds > 0) {
      applyPassiveDrain(deltaSeconds);
    }
  }, [applyPassiveDrain, currentTime, phase]);

  // Defeat checks:
  // - miss streak fails immediately (osu-style),
  // - HP fail starts after grace period.
  useEffect(() => {
    if (phase !== 'playing') return;

    if (gameplaySettings.missStreakFail !== null && missStreak >= gameplaySettings.missStreakFail) {
      triggerFail('miss_streak');
      return;
    }

    if (currentTime >= gameplaySettings.failGraceSec && health <= 0) {
      triggerFail('hp_depleted');
    }
  }, [
    currentTime,
    gameplaySettings.failGraceSec,
    gameplaySettings.missStreakFail,
    health,
    missStreak,
    phase,
    triggerFail,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearFailTimeout();
      closeAudio();
    };
  }, [clearFailTimeout, closeAudio]);

  // Handle pause/resume
  const togglePause = useCallback(() => {
    if (phase === 'playing') {
      audioContextRef.current?.suspend();
      setPhase('paused');
    } else if (phase === 'paused') {
      audioContextRef.current?.resume();
      setPhase('playing');
    }
  }, [phase, setPhase]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  useEffect(() => {
    if (!beatmap?.debug?.enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setShowDebugOverlay((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [beatmap?.debug?.enabled]);

  const debugReport = beatmap?.debug;
  const currentDebugWindow = useMemo(() => {
    if (!debugReport?.enabled || debugReport.windows.length === 0) return undefined;

    const windows = debugReport.windows;
    for (let i = 0; i < windows.length; i++) {
      const windowInfo = windows[i]!;
      const isLast = i === windows.length - 1;
      if (
        (currentTime >= windowInfo.startSec && currentTime < windowInfo.endSec) ||
        (isLast && currentTime >= windowInfo.startSec)
      ) {
        return windowInfo;
      }
    }

    return windows[windows.length - 1];
  }, [debugReport, currentTime]);

  const nextRiskWindow = useMemo(() => {
    if (!debugReport?.enabled || currentDebugWindow === undefined) return undefined;
    return debugReport.worstWindows.find((windowInfo) => windowInfo.startSec > currentDebugWindow.endSec);
  }, [debugReport, currentDebugWindow]);

  const currentDropSummary = useMemo(() => {
    if (!currentDebugWindow) return 'none';

    const entries = Object.entries(currentDebugWindow.dropReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);

    if (entries.length === 0) return 'none';

    return entries
      .map(([reason, count]) => `${formatDebugReason(reason)} (${count})`)
      .join(' | ');
  }, [currentDebugWindow]);

  const debugSeverityColor = useMemo(() => {
    if (!currentDebugWindow) return '#a0b890';
    if (currentDebugWindow.score >= 5) return '#d47070';
    if (currentDebugWindow.score >= 3) return '#f0d060';
    return '#7db86a';
  }, [currentDebugWindow]);

  if (!beatmap) {
    return <div>No beatmap loaded</div>;
  }

  return (
    <div ref={containerRef} style={styles.container}>
      {/* Game canvas */}
      <Game
        beatmap={beatmap}
        currentTime={currentTime}
        isPlaying={isPlaying && phase === 'playing'}
        volume={volume}
        onHit={playHitSound}
      />

      {/* HUD overlay */}
      <GameHUD
        currentTime={currentTime}
        duration={beatmap.metadata.duration}
        health={health}
        missStreak={missStreak}
        missStreakFail={gameplaySettings.missStreakFail}
        onPause={togglePause}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        showVolumeSlider={showVolumeSlider}
        onToggleVolumeSlider={() => setShowVolumeSlider(!showVolumeSlider)}
      />

      {/* Live beatmap diagnostics overlay */}
      {phase === 'playing' && debugReport?.enabled && showDebugOverlay && currentDebugWindow && (
        <div style={styles.debugOverlay}>
          <div style={styles.debugHeaderRow}>
            <span style={styles.debugTitle}>Live Mapper Debug</span>
            <span style={styles.debugHotkey}>F3 to hide</span>
          </div>
          <div style={styles.debugTimeRow}>
            <span>
              Bin {currentDebugWindow.startSec.toFixed(1)}s-{currentDebugWindow.endSec.toFixed(1)}s
            </span>
            <span style={{ ...styles.debugScore, color: debugSeverityColor }}>
              score {currentDebugWindow.score.toFixed(2)}
            </span>
          </div>
          <div style={styles.debugStatGrid}>
            <span>NPS {currentDebugWindow.notesPerSecond.toFixed(2)}</span>
            <span>Max gap {currentDebugWindow.maxGapSec.toFixed(2)}s</span>
            <span>Lane H {currentDebugWindow.laneEntropy.toFixed(2)}</span>
            <span>Type H {currentDebugWindow.typeEntropy.toFixed(2)}</span>
            <span>Streak {currentDebugWindow.longestSameLaneStreak}</span>
            <span>Notes {currentDebugWindow.notes}</span>
          </div>
          <div style={styles.debugLine}>
            Drops: <span style={styles.debugDetailText}>{currentDropSummary}</span>
          </div>
          <div style={styles.debugLine}>
            Next risk:{' '}
            <span style={styles.debugDetailText}>
              {nextRiskWindow
                ? `${nextRiskWindow.startSec.toFixed(1)}s-${nextRiskWindow.endSec.toFixed(1)}s (score ${nextRiskWindow.score.toFixed(2)})`
                : 'none'}
            </span>
          </div>
        </div>
      )}

      {phase === 'playing' && debugReport?.enabled && !showDebugOverlay && (
        <div style={styles.debugCollapsedHint}>Live Mapper Debug hidden (F3)</div>
      )}

      {/* Countdown overlay */}
      {phase === 'countdown' && countdown > 0 && (
        <div style={styles.countdownOverlay}>
          <div style={styles.countdownNumber}>{countdown}</div>
          <div style={styles.countdownControls}>
            <span style={styles.countdownControlsTitle}>CONTROLS</span>
            <div style={styles.countdownKeyRow}>
              <span style={styles.countdownKey}>←</span>
              <span style={styles.countdownKey}>↑</span>
              <span style={styles.countdownKey}>→</span>
            </div>
            <p style={styles.countdownHint}>Left / Center / Right lane</p>
            <p style={styles.countdownAltHint}>A / W / D + SPACE also work</p>
          </div>
        </div>
      )}

      {/* Pause overlay */}
      {phase === 'paused' && (
        <div style={styles.pauseOverlay}>
          <h2 style={styles.pauseTitle}>Paused</h2>

          {/* Volume control in pause menu */}
          <div style={styles.volumeControl}>
            <span style={styles.volumeLabel}>Music Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              style={styles.volumeSlider}
            />
            <span style={styles.volumeValue}>{Math.round(volume * 100)}%</span>
          </div>

          <button onClick={togglePause} style={styles.resumeButton}>
            Resume
          </button>
          <button
            onClick={() => {
              ignoreOnEndedRef.current = true;
              clearFailTimeout();
              closeAudio();
              setIsPlaying(false);
              setCurrentTime(0);
              setCountdown(3);
              resetGame();
            }}
            style={{ ...styles.resumeButton, background: 'rgba(60, 55, 70, 0.5)', borderColor: '#4a4555' }}
          >
            Quit
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
    background: '#0d0b0f',
    overflow: 'hidden',
  },
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(13, 11, 15, 0.7)',
    zIndex: 100,
  },
  countdownNumber: {
    fontSize: '120px',
    fontWeight: 700,
    color: '#c09080',
    textShadow: '0 0 60px rgba(192, 144, 128, 0.4)',
  },
  countdownHint: {
    margin: 0,
    fontSize: '14px',
    color: '#555',
    fontWeight: 'bold',
    letterSpacing: '0.4px',
  },
  countdownControls: {
    marginTop: '20px',
    padding: '16px 24px',
    minWidth: '280px',
    background: '#ffffff',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    fontFamily: '"Courier New", Courier, monospace',
  },
  countdownControlsTitle: {
    fontSize: '12px',
    color: '#888',
    letterSpacing: '2px',
    fontWeight: 'bold',
  },
  countdownKeyRow: {
    display: 'flex',
    gap: '8px',
  },
  countdownKey: {
    minWidth: '42px',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '2px solid #e0e0e0',
    background: '#f9f9f9',
    color: '#333',
    fontSize: '22px',
    fontWeight: 'bold',
    lineHeight: 1,
    textAlign: 'center',
    boxShadow: '0 2px 0 #e0e0e0',
  },
  countdownAltHint: {
    margin: 0,
    fontSize: '12px',
    color: '#888',
    letterSpacing: '0.2px',
  },
  pauseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    background: 'rgba(13, 11, 15, 0.9)',
    zIndex: 100,
  },
  pauseTitle: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#e0d5c8',
    marginBottom: '24px',
    textShadow: '0 0 40px rgba(200, 180, 160, 0.3)',
  },
  volumeControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    padding: '16px 24px',
    background: 'rgba(200, 180, 160, 0.05)',
    borderRadius: '12px',
    border: '1px solid rgba(200, 180, 160, 0.1)',
  },
  volumeLabel: {
    fontSize: '14px',
    color: '#8a8090',
    minWidth: '100px',
  },
  volumeSlider: {
    width: '150px',
    height: '8px',
    cursor: 'pointer',
    accentColor: '#c09080',
  },
  volumeValue: {
    fontSize: '14px',
    color: '#e0d5c8',
    minWidth: '50px',
    textAlign: 'right',
  },
  resumeButton: {
    padding: '16px 48px',
    fontSize: '18px',
    minWidth: '200px',
  },
  debugOverlay: {
    position: 'absolute',
    left: '16px',
    top: '16px',
    width: '340px',
    background: 'rgba(15, 18, 22, 0.88)',
    border: '1px solid rgba(140, 170, 200, 0.45)',
    borderRadius: '10px',
    padding: '10px 12px',
    color: '#d8e2ef',
    fontSize: '11px',
    letterSpacing: '0.2px',
    pointerEvents: 'none',
    zIndex: 25,
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
  },
  debugHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '6px',
  },
  debugTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#f7fbff',
  },
  debugHotkey: {
    fontSize: '10px',
    color: '#a5b7cd',
  },
  debugTimeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px',
    color: '#c5d4e6',
  },
  debugScore: {
    fontWeight: 700,
  },
  debugStatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '4px 10px',
    marginBottom: '6px',
    color: '#e0ebf7',
  },
  debugLine: {
    marginTop: '4px',
    color: '#b8c8da',
  },
  debugDetailText: {
    color: '#f1f7ff',
  },
  debugCollapsedHint: {
    position: 'absolute',
    left: '16px',
    top: '16px',
    padding: '6px 10px',
    background: 'rgba(15, 18, 22, 0.78)',
    border: '1px solid rgba(140, 170, 200, 0.35)',
    borderRadius: '8px',
    color: '#d8e2ef',
    fontSize: '11px',
    pointerEvents: 'none',
    zIndex: 25,
  },
};

function formatDebugReason(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
