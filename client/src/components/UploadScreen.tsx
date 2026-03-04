import { useRef, useState } from 'react';

import { useGameStore } from '../store/gameStore';
interface DifficultyButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function DifficultyButton({ label, active, onClick }: DifficultyButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.difficultyBtn,
        ...(active ? styles.difficultyBtnActive : {}),
      }}
    >
      {label}
    </button>
  );
}

export default function UploadScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const setScreen = useGameStore((state) => state.setScreen);
  const setAudioBuffer = useGameStore((state) => state.setAudioBuffer);
  const setBeatmap = useGameStore((state) => state.setBeatmap);
  const setPhase = useGameStore((state) => state.setPhase);
  const resetScore = useGameStore((state) => state.resetScore);
  const setSongTitle = useGameStore((state) => state.setSongTitle);
  const difficulty = useGameStore((state) => state.difficulty);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  const musicVolume = useGameStore((state) => state.musicVolume);
  const setMusicVolume = useGameStore((state) => state.setMusicVolume);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('audio/')) {
      alert('Please upload an audio file (MP3, WAV, OGG)');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await audioContext.close();

      const cleanedTitle = file.name.replace(/\.[^/.]+$/, '');
      resetScore();
      setPhase('countdown');
      setBeatmap(null);
      setSongTitle(cleanedTitle);
      setAudioBuffer(audioBuffer);
      setScreen('loading');
    } catch (error) {
      console.error('Failed to decode audio:', error);
      alert('Failed to load audio file. Please try a different file.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMusicVolume(Number.parseFloat(e.target.value));
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.titleBlock}>
          <h1 style={styles.title}>PING</h1>
          <h1 style={styles.titleAlt}>PONG</h1>
        </div>
        <p style={styles.subtitle}>BEAT</p>

        <div
          style={{
            ...styles.dropZone,
            ...(dragOver ? styles.dropZoneActive : {}),
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
        >
          <div style={styles.dropIcon}>
            [ + ]
          </div>
          <p style={styles.dropText}>DROP AUDIO FILE</p>
          <p style={styles.dropSubtext}>or click to browse</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        <div style={styles.difficultyContainer}>
          <div style={styles.difficultyButtons}>
            <DifficultyButton
              label="NOOB"
              active={difficulty === 'noob'}
              onClick={() => setDifficulty('noob')}
            />
            <DifficultyButton
              label="PRO"
              active={difficulty === 'pro'}
              onClick={() => setDifficulty('pro')}
            />
            <DifficultyButton
              label="HACKER"
              active={difficulty === 'hacker'}
              onClick={() => setDifficulty('hacker')}
            />
          </div>
          <p style={styles.difficultyDesc}>
            {difficulty === 'noob' && 'Forgiving timing. Good for beginners.'}
            {difficulty === 'pro' && 'The intended experience. Balanced.'}
            {difficulty === 'hacker' && 'Tight timing. Fast balls. No mercy.'}
          </p>
        </div>

        <div style={styles.volumeContainer}>
          <span style={styles.volumeLabel}>MUSIC VOLUME</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={musicVolume}
            onChange={handleVolumeChange}
            style={styles.volumeSlider}
          />
          <span style={styles.volumeValue}>{Math.round(musicVolume * 100)}%</span>
        </div>

        <div style={styles.instructions}>
          <p style={styles.instructionLine}>&gt; upload any song</p>
          <p style={styles.instructionLine}>&gt; hit balls on beat</p>
          <p style={styles.instructionLine}>&gt; hold blue notes</p>
          <p style={styles.instructionLine}>&gt; don't miss</p>
        </div>

        <div style={styles.controls}>
          <span style={styles.controlKey}>[SPACE]</span>
          <span style={styles.controlText}> or </span>
          <span style={styles.controlKey}>[CLICK]</span>
          <span style={styles.controlText}> to hit</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f0f0f0', // Light background
    backgroundImage: `
      linear-gradient(45deg, #e8e8e8 25%, transparent 25%, transparent 75%, #e8e8e8 75%, #e8e8e8),
      linear-gradient(45deg, #e8e8e8 25%, transparent 25%, transparent 75%, #e8e8e8 75%, #e8e8e8)
    `,
    backgroundSize: '40px 40px',
    backgroundPosition: '0 0, 20px 20px',
    fontFamily: '"Courier New", Courier, monospace',
    color: '#333',
  },
  content: {
    textAlign: 'center',
    padding: '40px',
    background: '#ffffff',
    border: '4px solid #333',
    boxShadow: '10px 10px 0px rgba(0,0,0,0.2)',
    maxWidth: '500px',
    width: '90%',
  },
  titleBlock: {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    marginBottom: '4px',
  },
  title: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#4d80c9', // Blue
    margin: 0,
    letterSpacing: '4px',
    textShadow: '2px 2px 0px #333',
  },
  titleAlt: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#d05050', // Red
    margin: 0,
    letterSpacing: '4px',
    textShadow: '2px 2px 0px #333',
  },
  subtitle: {
    fontSize: '24px',
    color: '#333',
    marginBottom: '40px',
    letterSpacing: '12px',
    fontWeight: 'bold',
  },
  dropZone: {
    width: '100%',
    padding: '30px',
    border: '3px dashed #ccc',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: '#f9f9f9',
    margin: '0 auto',
  },
  dropZoneActive: {
    borderColor: '#4d80c9',
    background: 'rgba(77, 128, 201, 0.1)',
  },
  dropIcon: {
    color: '#333',
    fontSize: '24px',
    marginBottom: '10px',
    fontWeight: 'bold',
  },
  dropText: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#333',
    marginBottom: '4px',
    letterSpacing: '1px',
  },
  dropSubtext: {
    fontSize: '12px',
    color: '#666',
    margin: 0,
  },
  difficultyContainer: {
    marginTop: '30px',
  },
  difficultyButtons: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    marginTop: '10px',
    flexWrap: 'wrap',
  },
  label: {
    fontSize: '12px',
    color: '#666',
    letterSpacing: '2px',
    marginBottom: '8px',
    fontWeight: 'bold',
  },
  difficultyBtn: {
    background: '#fff',
    border: '2px solid #ccc',
    color: '#666',
    padding: '8px 12px',
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 2px 0 #ccc',
    transform: 'translateY(0)',
  },
  difficultyBtnActive: {
    borderColor: '#4d80c9',
    color: '#fff',
    background: '#4d80c9',
    boxShadow: '0 2px 0 #365f9b',
  },
  difficultyDesc: {
    fontSize: '11px',
    color: '#888',
    marginTop: '12px',
    height: '14px', // Prevent layout shift
    fontStyle: 'italic',
  },
  volumeContainer: {
    marginTop: '24px',
    padding: '14px 16px',
    border: '2px solid #d8d8d8',
    background: '#f8f8f8',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto',
    columnGap: '10px',
    rowGap: '8px',
    alignItems: 'center',
  },
  volumeLabel: {
    gridColumn: '1 / 2',
    gridRow: '1 / 2',
    fontSize: '11px',
    color: '#666',
    letterSpacing: '1.5px',
    fontWeight: 'bold',
    textAlign: 'left',
  },
  volumeSlider: {
    gridColumn: '1 / 2',
    gridRow: '2 / 3',
    width: '100%',
    cursor: 'pointer',
    accentColor: '#4d80c9',
  },
  volumeValue: {
    gridColumn: '2 / 3',
    gridRow: '2 / 3',
    fontSize: '12px',
    color: '#333',
    fontWeight: 'bold',
    minWidth: '44px',
    textAlign: 'right',
  },
  instructions: {
    marginTop: '40px',
    textAlign: 'left',
    maxWidth: '240px',
    margin: '40px auto 0',
    background: '#f5f5f5',
    padding: '15px',
    border: '1px solid #ddd',
  },
  instructionLine: {
    fontSize: '12px',
    color: '#555',
    margin: '6px 0',
    letterSpacing: '0px',
    fontFamily: 'monospace',
  },
  controls: {
    marginTop: '30px',
    fontSize: '11px',
    color: '#666',
  },
  controlKey: {
    color: '#333',
    fontWeight: 'bold',
    background: '#ddd',
    padding: '2px 4px',
    borderRadius: '4px',
  },
  controlText: {
    color: '#666',
  },
};
