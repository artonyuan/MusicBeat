import { useGameStore } from '../store/gameStore';

interface GameHUDProps {
  currentTime: number;
  duration: number;
  onPause: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  showVolumeSlider: boolean;
  onToggleVolumeSlider: () => void;
}

export default function GameHUD({
  currentTime,
  duration,
  onPause,
  volume,
  onVolumeChange,
  showVolumeSlider,
  onToggleVolumeSlider,
}: GameHUDProps) {
  const score = useGameStore((state) => state.score);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = Math.min((currentTime / duration) * 100, 100);

  return (
    <div style={styles.container}>
      {/* Top Bar - White Box Design */}
      <div style={styles.topBarContainer}>
        <div style={styles.scoreBox}>
          {/* Score */}
          <div style={styles.scoreSection}>
            <span style={styles.label}>SCORE</span>
            <span style={styles.value}>{Math.floor(score.score).toLocaleString()}</span>
          </div>
          
          <div style={styles.divider} />

          {/* Combo */}
          <div style={styles.scoreSection}>
            <span style={styles.label}>COMBO</span>
            <span style={styles.value}>{score.combo}</span>
          </div>
        </div>
      </div>

      {/* Controls - Top Right */}
      <div style={styles.controlsContainer}>
        {/* Volume button */}
        <div style={styles.volumeContainer}>
          <button
            onClick={onToggleVolumeSlider}
            style={styles.controlButton}
            title="Volume"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              {volume > 0.5 ? (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              ) : volume > 0 ? (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              ) : (
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              )}
            </svg>
          </button>

          {/* Volume slider dropdown */}
          {showVolumeSlider && (
            <div style={styles.volumeSliderContainer}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                style={styles.volumeSlider}
              />
              <span style={styles.volumeText}>{Math.round(volume * 100)}%</span>
            </div>
          )}
        </div>

        {/* Pause button */}
        <button onClick={onPause} style={styles.controlButton} title="Pause (ESC)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </button>
      </div>

      {/* Progress bar at bottom */}
      <div style={styles.progressContainer}>
        <span style={styles.timeText}>{formatTime(currentTime)}</span>
        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressBar,
              width: `${progress}%`,
            }}
          />
        </div>
        <span style={styles.timeText}>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '20px',
    zIndex: 10,
    fontFamily: '"Courier New", Courier, monospace',
  },
  topBarContainer: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  scoreBox: {
    background: '#ffffff',
    padding: '10px 20px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    border: '2px solid #e0e0e0',
  },
  scoreSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  divider: {
    width: '1px',
    height: '30px',
    background: '#e0e0e0',
  },
  label: {
    fontSize: '10px',
    color: '#888',
    fontWeight: 'bold',
    letterSpacing: '1px',
  },
  value: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    lineHeight: '1',
  },
  controlsContainer: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  volumeContainer: {
    position: 'relative',
  },
  controlButton: {
    pointerEvents: 'auto',
    background: '#ffffff',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    padding: '8px',
    color: '#555',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  volumeSliderContainer: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '8px',
    background: '#ffffff',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    pointerEvents: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  volumeSlider: {
    width: '100px',
    cursor: 'pointer',
    accentColor: '#4d80c9',
  },
  volumeText: {
    fontSize: '10px',
    color: '#555',
    letterSpacing: '1px',
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'rgba(255, 255, 255, 0.9)',
    padding: '8px 16px',
    borderRadius: '20px',
    alignSelf: 'center',
    width: '60%',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  progressTrack: {
    flex: 1,
    height: '6px',
    background: '#e0e0e0',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: '#4d80c9',
    transition: 'width 0.1s linear',
    borderRadius: '3px',
  },
  timeText: {
    fontSize: '12px',
    color: '#555',
    fontWeight: 'bold',
    minWidth: '45px',
    textAlign: 'center',
  },
};
