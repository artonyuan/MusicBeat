import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';

import { clearAnonymousSession, getAnonymousSessionToken } from '../api/anonymousSession';
import { downloadBeatmapDebugReport } from '../beatmap/beatmapDebug';
import { useGameStore } from '../store/gameStore';
import { DIFFICULTY_PRESETS } from '../types/game';

import type { ChangeEvent } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

function getApiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  const normalizedBaseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBaseUrl}${path}`;
}

async function getApiErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as ApiErrorPayload;
    const errorMessage = typeof payload.error === 'string' ? payload.error.trim() : '';
    if (errorMessage) return errorMessage;
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (message) return message;
  } catch (error) {
    console.error('Failed to parse API error response:', error);
  }

  return fallbackMessage;
}

function toShareErrorMessage(error: unknown): string {
  const fallbackMessage = 'Could not create a share link. Try again.';
  if (!(error instanceof Error)) return fallbackMessage;

  const detail = error.message.trim();
  if (!detail || detail.toLowerCase() === 'error') return fallbackMessage;
  if (detail === 'Failed to fetch') {
    return 'Could not reach the server. Start the backend and try again.';
  }

  return `${fallbackMessage} ${detail}`;
}

function getGrade(accuracy: number) {
  if (accuracy >= 95) return { grade: 'S', color: '#ffeb3b' };
  if (accuracy >= 90) return { grade: 'A', color: '#4d80c9' };
  if (accuracy >= 80) return { grade: 'B', color: '#7dae5e' };
  if (accuracy >= 70) return { grade: 'C', color: '#ffa726' };
  if (accuracy >= 60) return { grade: 'D', color: '#ef5350' };
  return { grade: 'F', color: '#8d6e63' };
}

function buildShareUrl(id: string) {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}?run=${id}`;
}

export default function ResultsScreen() {
  const score = useGameStore((state) => state.score);
  const resetGame = useGameStore((state) => state.resetGame);
  const setScreen = useGameStore((state) => state.setScreen);
  const setPhase = useGameStore((state) => state.setPhase);
  const resetScore = useGameStore((state) => state.resetScore);
  const beatmap = useGameStore((state) => state.beatmap);
  const difficulty = useGameStore((state) => state.difficulty);
  const playerHandle = useGameStore((state) => state.playerHandle);
  const setPlayerHandle = useGameStore((state) => state.setPlayerHandle);
  const songTitle = useGameStore((state) => state.songTitle);
  const setSongTitle = useGameStore((state) => state.setSongTitle);
  const runOutcome = useGameStore((state) => state.runOutcome);

  const [shareId, setShareId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const shareCardRef = useRef<HTMLDivElement>(null);

  const totalNotes = score.perfectCount + score.goodCount + score.okCount + score.missCount;
  const accuracyValue = totalNotes > 0
    ? ((score.perfectCount + score.goodCount * 0.7 + score.okCount * 0.3) / totalNotes) * 100
    : 0;
  const accuracy = accuracyValue.toFixed(1);

  const scoreValue = Math.floor(score.score);
  const safeHandle = playerHandle.trim() || 'player';
  const safeTitle = songTitle.trim() || beatmap?.metadata.title || 'Untitled Track';
  const bpm = beatmap?.timing.bpm ?? 0;
  const duration = beatmap?.metadata.duration ?? 0;
  const missStreakFail = DIFFICULTY_PRESETS[difficulty].missStreakFail;

  const { grade, color } = getGrade(accuracyValue);
  const failed = runOutcome === 'hp_depleted' || runOutcome === 'miss_streak';
  const failedReason = runOutcome === 'miss_streak'
    ? (missStreakFail !== null
      ? `Failed (${missStreakFail} miss streak)`
      : 'Failed (miss streak)')
    : runOutcome === 'hp_depleted'
      ? 'Failed (HP depleted)'
      : null;
  const shareText = failed
    ? `I failed in Pong. ${scoreValue} pts ${accuracy}% accuracy`
    : `My wrists survived. ${scoreValue} pts ${accuracy}% accuracy`;
  const shareUrl = shareId ? buildShareUrl(shareId) : '';
  const debugReport = beatmap?.debug;

  const resetShareState = () => {
    setShareId(null);
    setShareError(null);
    setCopyMessage(null);
    setShareStatus('idle');
  };

  const handleHandleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPlayerHandle(event.target.value);
    resetShareState();
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSongTitle(event.target.value);
    resetShareState();
  };

  const handleRetry = () => {
    resetScore();
    setPhase('countdown');
    setScreen('playing');
  };

  const handleNewSong = () => {
    resetGame();
  };

  const handleShare = async () => {
    if (!beatmap) {
      setShareError('Missing beatmap data.');
      setShareStatus('error');
      return;
    }

    setShareStatus('saving');
    setShareError(null);
    setCopyMessage(null);

    try {
      const body = JSON.stringify({
        title: safeTitle,
        handle: safeHandle,
        score: scoreValue,
        accuracy: Number(accuracyValue.toFixed(1)),
        maxCombo: score.maxCombo,
        grade,
        perfectCount: score.perfectCount,
        goodCount: score.goodCount,
        okCount: score.okCount,
        missCount: score.missCount,
        bpm,
        duration,
        difficulty,
      });

      const sendRunRequest = async (forceSessionRefresh: boolean): Promise<Response> => {
        const sessionToken = await getAnonymousSessionToken({ forceRefresh: forceSessionRefresh });
        return fetch(getApiUrl('/api/run'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
          body,
        });
      };

      let response = await sendRunRequest(false);
      if (response.status === 401) {
        clearAnonymousSession();
        response = await sendRunRequest(true);
      }

      if (!response.ok) {
        const errorMessage = await getApiErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setShareId(data.id as string);
      setShareStatus('saved');
    } catch (error) {
      console.error('Failed to save run:', error);
      setShareError(toShareErrorMessage(error));
      setShareStatus('error');
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage('Link copied.');
    } catch (error) {
      console.error('Copy failed:', error);
      setCopyMessage('Copy failed.');
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopyMessage('Share text copied.');
    } catch (error) {
      console.error('Copy failed:', error);
      setCopyMessage('Copy failed.');
    }
  };

  const handleDownloadCard = async () => {
    if (!shareCardRef.current) return;

    try {
      const dataUrl = await toPng(shareCardRef.current, { cacheBust: true });
      const link = document.createElement('a');
      link.download = `pong-${safeTitle}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Card export failed:', error);
      setShareError('Failed to export share card.');
    }
  };

  const handleDownloadDebugReport = () => {
    if (!debugReport) return;

    downloadBeatmapDebugReport(debugReport, safeTitle);
    setCopyMessage('Debug report downloaded.');
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>{failed ? 'MATCH FAILED' : 'MATCH RESULTS'}</h1>

        {failedReason && <p style={styles.failReason}>{failedReason}</p>}

        <div style={styles.gradeContainer}>
          <span style={{ ...styles.grade, color }}>{grade}</span>
        </div>

        <div style={styles.scoreSection}>
          <span style={styles.scoreLabel}>Final Score</span>
          <span style={styles.scoreValue}>{scoreValue.toLocaleString()}</span>
        </div>

        <div style={styles.statsGrid}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{accuracy}%</span>
            <span style={styles.statLabel}>Accuracy</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{score.maxCombo}</span>
            <span style={styles.statLabel}>Max Combo</span>
          </div>
        </div>

        <div style={styles.breakdown}>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#ffeb3b' }}>{score.perfectCount}</span>
            <span style={styles.breakdownLabel}>Perfect</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#7dae5e' }}>{score.goodCount}</span>
            <span style={styles.breakdownLabel}>Good</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#4d80c9' }}>{score.okCount}</span>
            <span style={styles.breakdownLabel}>OK</span>
          </div>
          <div style={styles.breakdownItem}>
            <span style={{ ...styles.breakdownCount, color: '#ef5350' }}>{score.missCount}</span>
            <span style={styles.breakdownLabel}>Miss</span>
          </div>
        </div>

        <div style={styles.shareSection}>
          <h2 style={styles.shareTitle}>Share Run</h2>
          <div style={styles.inputRow}>
            <label style={styles.inputLabel}>Player Handle</label>
            <input
              value={playerHandle}
              onChange={handleHandleChange}
              style={styles.input}
              placeholder="player"
            />
          </div>
          <div style={styles.inputRow}>
            <label style={styles.inputLabel}>Song Title</label>
            <input
              value={songTitle}
              onChange={handleTitleChange}
              style={styles.input}
              placeholder="Untitled Track"
            />
          </div>

          <div style={styles.shareButtons}>
            <button
              onClick={handleShare}
              style={{
                ...styles.sharePrimaryButton,
                ...(shareStatus === 'saving' ? styles.shareButtonDisabled : {}),
              }}
              disabled={shareStatus === 'saving'}
            >
              {shareStatus === 'saving' ? 'Creating Link...' : 'Create Share Link'}
            </button>
            <button onClick={handleDownloadCard} style={styles.shareSecondaryButton}>
              Download Card
            </button>
            <button onClick={handleCopyText} style={styles.shareSecondaryButton}>
              Copy Share Text
            </button>
            {debugReport && (
              <button onClick={handleDownloadDebugReport} style={styles.shareSecondaryButton}>
                Download Debug JSON
              </button>
            )}
          </div>

          {!debugReport && (
            <p style={styles.debugHint}>
              Need mapping diagnostics? Open with <code>?debugBeatmap=1</code> and regenerate the beatmap.
            </p>
          )}

          {shareError && <p style={styles.shareError}>{shareError}</p>}

          {shareUrl && (
            <div style={styles.shareLinkBox}>
              <span style={styles.shareLinkLabel}>Share Link</span>
              <div style={styles.shareLinkRow}>
                <span style={styles.shareLink}>{shareUrl}</span>
                <button onClick={handleCopyLink} style={styles.shareLinkButton}>
                  Copy
                </button>
              </div>
            </div>
          )}
          {copyMessage && <span style={styles.copyMessage}>{copyMessage}</span>}
        </div>

        <div style={styles.shareCardPreview}>
          <div ref={shareCardRef} style={styles.shareCard}>
            <div style={styles.shareCardHeader}>
              <span style={styles.shareCardTitle}>Pong</span>
              <span style={styles.shareCardHandle}>@{safeHandle}</span>
            </div>
            <div style={styles.shareCardSong}>{safeTitle}</div>
            <div style={styles.shareCardScore}>{scoreValue.toLocaleString()} pts</div>
            <div style={styles.shareCardStats}>
              <div style={styles.shareCardStat}>Accuracy {accuracy}%</div>
              <div style={styles.shareCardStat}>Max Combo {score.maxCombo}</div>
              <div style={styles.shareCardStat}>BPM {Math.round(bpm)}</div>
              <div style={styles.shareCardStat}>Diff {difficulty.toUpperCase()}</div>
            </div>
            <div style={styles.shareCardFooter}>My wrists survived.</div>
          </div>
        </div>

        <div style={styles.buttons}>
          <button onClick={handleRetry} style={styles.primaryButton}>
            Play Again
          </button>
          <button onClick={handleNewSong} style={styles.secondaryButton}>
            New Song
          </button>
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
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '24px 16px',
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
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#333',
    marginBottom: '32px',
    textTransform: 'uppercase',
    letterSpacing: '4px',
  },
  failReason: {
    marginTop: '-20px',
    marginBottom: '24px',
    color: '#d05050',
    fontSize: '13px',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  gradeContainer: {
    marginBottom: '40px',
  },
  grade: {
    fontSize: '120px',
    fontWeight: 900,
    lineHeight: 1,
    textShadow: '4px 4px 0px rgba(0,0,0,0.1)',
    fontFamily: 'Verdana, sans-serif',
  },
  scoreSection: {
    marginBottom: '40px',
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
    display: 'flex',
    justifyContent: 'center',
    gap: '60px',
    marginBottom: '40px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statValue: {
    fontSize: '24px',
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
    marginBottom: '48px',
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
  shareSection: {
    textAlign: 'left',
    padding: '24px',
    border: '2px solid #eee',
    background: '#fdfdfd',
    marginBottom: '32px',
  },
  shareTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#333',
    marginBottom: '16px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
  },
  inputRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '12px',
  },
  inputLabel: {
    fontSize: '11px',
    color: '#777',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 'bold',
  },
  input: {
    padding: '10px 12px',
    border: '2px solid #ccc',
    fontSize: '14px',
    fontFamily: '"Courier New", Courier, monospace',
    outline: 'none',
  },
  shareButtons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginTop: '12px',
  },
  sharePrimaryButton: {
    padding: '12px 18px',
    fontSize: '12px',
    background: '#4d80c9',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
    boxShadow: '0 3px 0 #365f9b',
  },
  shareSecondaryButton: {
    padding: '12px 18px',
    fontSize: '12px',
    background: '#fff',
    border: '2px solid #ccc',
    color: '#666',
    cursor: 'pointer',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
    boxShadow: '0 3px 0 #bbb',
  },
  shareButtonDisabled: {
    opacity: 0.6,
    cursor: 'default',
  },
  shareError: {
    marginTop: '12px',
    color: '#d05050',
    fontSize: '12px',
    letterSpacing: '1px',
  },
  debugHint: {
    marginTop: '12px',
    marginBottom: 0,
    color: '#666',
    fontSize: '11px',
    letterSpacing: '0.5px',
  },
  shareLinkBox: {
    marginTop: '16px',
    padding: '12px',
    border: '2px dashed #ddd',
    background: '#f9f9f9',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  shareLinkLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 'bold',
    color: '#666',
  },
  shareLinkRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  shareLink: {
    flex: 1,
    fontSize: '12px',
    wordBreak: 'break-all',
    color: '#333',
  },
  shareLinkButton: {
    padding: '8px 12px',
    border: '2px solid #ccc',
    background: '#fff',
    fontSize: '11px',
    letterSpacing: '1px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
  },
  copyMessage: {
    fontSize: '11px',
    color: '#4d80c9',
    letterSpacing: '1px',
  },
  shareCardPreview: {
    marginBottom: '32px',
  },
  shareCard: {
    padding: '24px',
    border: '3px solid #333',
    background: '#ffffff',
    boxShadow: '6px 6px 0px rgba(0,0,0,0.15)',
    textAlign: 'left',
  },
  shareCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  shareCardTitle: {
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '2px',
    textTransform: 'uppercase',
  },
  shareCardHandle: {
    fontSize: '12px',
    color: '#666',
    letterSpacing: '1px',
  },
  shareCardSong: {
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '12px',
    color: '#4d80c9',
  },
  shareCardScore: {
    fontSize: '32px',
    fontWeight: 900,
    marginBottom: '12px',
    letterSpacing: '1px',
  },
  shareCardStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px 16px',
    marginBottom: '16px',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  shareCardStat: {
    fontWeight: 'bold',
    color: '#444',
  },
  shareCardFooter: {
    fontSize: '12px',
    color: '#888',
    letterSpacing: '1px',
  },
  buttons: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
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
    minWidth: '160px',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
    boxShadow: '0 4px 0 #365f9b',
    transition: 'transform 0.1s',
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
    minWidth: '160px',
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 'bold',
    boxShadow: '0 4px 0 #bbb',
    transition: 'transform 0.1s',
  },
};
