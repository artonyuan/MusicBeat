import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import Game from '../game/Game';
import GameHUD from './GameHUD';

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [volume, setVolume] = useState(0.3); // Start at 30%
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Hit sound buffer
  const hitSoundBufferRef = useRef<AudioBuffer | null>(null);

  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const beatmap = useGameStore((state) => state.beatmap);
  const phase = useGameStore((state) => state.phase);
  const setPhase = useGameStore((state) => state.setPhase);
  const setScreen = useGameStore((state) => state.setScreen);

  // Load hit sound effect from file
  useEffect(() => {
    const loadHitSound = async () => {
      try {
        const response = await fetch('/sounds/hit.mp3');
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const audioContext = new AudioContext();
          const buffer = await audioContext.decodeAudioData(arrayBuffer);
          hitSoundBufferRef.current = buffer;
          audioContext.close();
          console.log('Loaded custom hit sound');
        } else {
          // Fallback: generate sound if file not found
          generateHitSound();
        }
      } catch (e) {
        console.log('Using generated hit sound');
        generateHitSound();
      }
    };

    const generateHitSound = async () => {
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

    loadHitSound();
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
    setVolume(newVolume);

    if (gainNodeRef.current) {
      // Direct value assignment - works immediately
      // Use small value instead of 0 to avoid clicks, but true 0 for mute
      gainNodeRef.current.gain.value = newVolume === 0 ? 0 : newVolume;
    }
  }, []);

  // Start the game audio - only call once!
  const startGame = useCallback(() => {
    // Guard: don't start if already playing
    if (!audioBuffer || audioContextRef.current) return;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Create gain node for volume control (start at 30%)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.3;
    gainNodeRef.current = gainNode;

    // Create and connect source -> gain -> destination
    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    sourceNode.onended = () => {
      setPhase('ended');
      setScreen('results');
    };

    sourceNode.start(0);
    sourceNodeRef.current = sourceNode;
    startTimeRef.current = audioContext.currentTime;

    setIsPlaying(true);
    setPhase('playing');
  }, [audioBuffer, setPhase, setScreen]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        sourceNodeRef.current?.stop();
        audioContextRef.current?.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    };
  }, []);

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
        onPause={togglePause}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        showVolumeSlider={showVolumeSlider}
        onToggleVolumeSlider={() => setShowVolumeSlider(!showVolumeSlider)}
      />

      {/* Countdown overlay */}
      {phase === 'countdown' && countdown > 0 && (
        <div style={styles.countdownOverlay}>
          <div style={styles.countdownNumber}>{countdown}</div>
          <p style={styles.countdownHint}>Press SPACE or click to hit!</p>
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
              try {
                sourceNodeRef.current?.stop();
                audioContextRef.current?.close();
              } catch (e) {}
              setScreen('upload');
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
    marginTop: '20px',
    fontSize: '18px',
    color: '#8a8090',
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
};
