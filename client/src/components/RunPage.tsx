import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

interface RunData {
  id: string;
  title: string;
  handle: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: string;
  perfectCount: number;
  goodCount: number;
  okCount: number;
  missCount: number;
  bpm: number;
  duration: number;
  difficulty: string;
  createdAt: string;
}

function gradeColor(grade: string) {
  switch (grade) {
    case 'S':
      return '#ffeb3b';
    case 'A':
      return '#4d80c9';
    case 'B':
      return '#7dae5e';
    case 'C':
      return '#ffa726';
    case 'D':
      return '#ef5350';
    default:
      return '#8d6e63';
  }
}

function formatDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return '0:00';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface RunPageProps {
  runId: string;
}

export default function RunPage({ runId }: RunPageProps) {
  const [run, setRun] = useState<RunData | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadRun = async () => {
      setStatus('loading');
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/api/run/${runId}`);
        if (!response.ok) {
          throw new Error('Run not found');
        }

        const data = (await response.json()) as RunData;
        setRun(data);
        setStatus('ready');
      } catch (err) {
        console.error('Failed to load run:', err);
        setError('Could not load this run.');
        setStatus('error');
      }
    };

    loadRun();
  }, [runId]);

  const handlePlay = () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    window.location.href = baseUrl;
  };

  const handleCopyLink = async () => {
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage('Link copied.');
    } catch (err) {
      console.error('Copy failed:', err);
      setCopyMessage('Copy failed.');
    }
  };

  if (status === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.content}>
          <h1 style={styles.title}>Loading run...</h1>
        </div>
      </div>
    );
  }

  if (status === 'error' || !run) {
    return (
      <div style={styles.container}>
        <div style={styles.content}>
          <h1 style={styles.title}>Run not found</h1>
          <p style={styles.subtitle}>{error ?? 'Try another link.'}</p>
          <button onClick={handlePlay} style={styles.primaryButton}>
            Play Pong
          </button>
        </div>
      </div>
    );
  }

  const accuracy = run.accuracy.toFixed(1);
  const createdAt = new Date(run.createdAt).toLocaleString();
  const color = gradeColor(run.grade);

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>RUN RESULTS</h1>
        <p style={styles.subtitle}>Unlisted share page</p>

        <div style={styles.headerRow}>
          <div>
            <div style={styles.handle}>@{run.handle}</div>
            <div style={styles.songTitle}>{run.title}</div>
          </div>
          <div style={{ ...styles.grade, color }}>{run.grade}</div>
        </div>

        <div style={styles.scoreSection}>
          <span style={styles.scoreLabel}>Final Score</span>
          <span style={styles.scoreValue}>{run.score.toLocaleString()}</span>
        </div>

        <div style={styles.statsGrid}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{accuracy}%</span>
            <span style={styles.statLabel}>Accuracy</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{run.maxCombo}</span>
            <span style={styles.statLabel}>Max Combo</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{Math.round(run.bpm)}</span>
            <span style={styles.statLabel}>BPM</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{run.difficulty.toUpperCase()}</span>
            <span style={styles.statLabel}>Difficulty</span>
          </div>
        </div>

        <div style={styles.breakdown}>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#ffeb3b' }}>{run.perfectCount}</span>
            <span style={styles.breakdownLabel}>Perfect</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#7dae5e' }}>{run.goodCount}</span>
            <span style={styles.breakdownLabel}>Good</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#4d80c9' }}>{run.okCount}</span>
            <span style={styles.breakdownLabel}>OK</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#ef5350' }}>{run.missCount}</span>
            <span style={styles.breakdownLabel}>Miss</span>
          </div>
        </div>

        <div style={styles.metaRow}>
          <span>Length {formatDuration(run.duration)}</span>
          <span>Saved {createdAt}</span>
        </div>

        <div style={styles.buttons}>
          <button onClick={handlePlay} style={styles.primaryButton}>
            Play Your Own Song
          </button>
          <button onClick={handleCopyLink} style={styles.secondaryButton}>
            Copy Run Link
          </button>
        </div>
        {copyMessage && <p style={styles.copyMessage}>{copyMessage}</p>}
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
    maxWidth: '640px',
    width: '100%',
    background: '#ffffff',
    border: '4px solid #333',
    boxShadow: '10px 10px 0px rgba(0,0,0,0.2)',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#333',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '4px',
  },
  subtitle: {
    fontSize: '12px',
    color: '#888',
    marginBottom: '24px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
    textAlign: 'left',
  },
  handle: {
    fontSize: '14px',
    letterSpacing: '1px',
    color: '#666',
    textTransform: 'uppercase',
  },
  songTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#4d80c9',
  },
  grade: {
    fontSize: '64px',
    fontWeight: 900,
    lineHeight: 1,
  },
  scoreSection: {
    marginBottom: '32px',
  },
  scoreLabel: {
    display: 'block',
    fontSize: '12px',
    color: '#888',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    fontWeight: 'bold',
  },
  scoreValue: {
    fontSize: '40px',
    fontWeight: 700,
    color: '#333',
    letterSpacing: '2px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statValue: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#333',
    letterSpacing: '1px',
  },
  statLabel: {
    fontSize: '10px',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    fontWeight: 'bold',
  },
  breakdown: {
    display: 'flex',
    justifyContent: 'center',
    gap: '32px',
    marginBottom: '24px',
    padding: '20px',
    border: '2px dashed #ddd',
    background: '#f9f9f9',
  },
  breakdownItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    minWidth: '50px',
  },
  breakdownCount: {
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '1px',
  },
  breakdownLabel: {
    fontSize: '10px',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    fontWeight: 'bold',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#666',
    marginBottom: '24px',
    letterSpacing: '1px',
  },
  buttons: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  primaryButton: {
    padding: '14px 28px',
    fontSize: '14px',
    background: '#4d80c9',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    minWidth: '180px',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
    boxShadow: '0 4px 0 #365f9b',
  },
  secondaryButton: {
    padding: '14px 28px',
    fontSize: '14px',
    background: '#fff',
    border: '2px solid #ccc',
    color: '#666',
    cursor: 'pointer',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    minWidth: '180px',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
    boxShadow: '0 4px 0 #bbb',
  },
  copyMessage: {
    marginTop: '12px',
    color: '#4d80c9',
    fontSize: '12px',
    letterSpacing: '1px',
  },
};
