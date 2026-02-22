import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { analyzeBeatmap } from '../audio/BeatDetector';
import { generateBeatmap } from '../beatmap/BeatmapGenerator';

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('PREPARING');
  const [warning, setWarning] = useState<string | null>(null);
  const [dots, setDots] = useState('');

  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const setBeatmap = useGameStore((state) => state.setBeatmap);
  const setScreen = useGameStore((state) => state.setScreen);

  // Animated dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!audioBuffer) {
      setScreen('upload');
      return;
    }

    const analyze = async () => {
      try {
        setWarning(null);
        setStatus('ANALYZING BEATS');
        setProgress(20);

        const analysis = await analyzeBeatmap(audioBuffer);
        if (analysis.usedFallback) {
          setWarning('Low beat confidence — Simple Mode');
        }
        setProgress(60);

        setStatus('GENERATING MAP');
        const beatmap = generateBeatmap(analysis);
        setProgress(90);

        setStatus('READY');
        setProgress(100);

        setBeatmap(beatmap);

        setTimeout(() => {
          setScreen('playing');
        }, 500);
      } catch (error) {
        console.error('Analysis failed:', error);
        setStatus('ERROR');
      }
    };

    analyze();
  }, [audioBuffer, setBeatmap, setScreen]);

  // Create progress bar with blocks
  const blocks = 20;
  const filledBlocks = Math.floor((progress / 100) * blocks);
  const progressBar = '[' + '='.repeat(filledBlocks) + ' '.repeat(blocks - filledBlocks) + ']';

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.icon}>
           Wait...
        </div>

        <p style={styles.status}>{status}{dots}</p>
        {warning && <p style={styles.warning}>{warning}</p>}

        <p style={styles.progressBar}>{progressBar}</p>
        <p style={styles.progressText}>{progress}%</p>
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
    background: '#f0f0f0',
    fontFamily: '"Courier New", Courier, monospace',
  },
  content: {
    textAlign: 'center',
    padding: '40px',
    background: '#ffffff',
    border: '4px solid #333',
    boxShadow: '10px 10px 0px rgba(0,0,0,0.2)',
    width: '400px',
  },
  icon: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: '#4d80c9',
  },
  status: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '12px',
    letterSpacing: '2px',
    fontWeight: 'bold',
  },
  warning: {
    fontSize: '12px',
    color: '#8a8090',
    margin: '0 0 16px 0',
    letterSpacing: '1px',
  },
  progressBar: {
    fontSize: '16px',
    color: '#555',
    margin: '0 0 8px 0',
    letterSpacing: '2px',
    fontWeight: 'bold',
  },
  progressText: {
    fontSize: '14px',
    color: '#888',
    margin: 0,
  },
};
