import { useEffect, useRef, useCallback } from 'react';
import type { Beatmap, BeatNote, LaneIndex, NoteType } from '../types/beatmap';
import { useGameStore } from '../store/gameStore';
import type { HitResult } from '../types/game';

interface GameProps {
  beatmap: Beatmap;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  onHit: () => void;
}

// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// Table dimensions
const TABLE_WIDTH = 280;
const TABLE_HEIGHT = 380;
const TABLE_X = (CANVAS_WIDTH - TABLE_WIDTH) / 2;
const TABLE_Y = (CANVAS_HEIGHT - TABLE_HEIGHT) / 2 + 40; // Shift down for HUD visibility

// Positions
const PLAYER_Y = TABLE_Y + TABLE_HEIGHT + 35;
const NPC_Y = TABLE_Y - 55;
const CENTER_X = CANVAS_WIDTH / 2;
const LANE_OFFSET = 80; // Distance between lanes
const LANES = [CENTER_X - LANE_OFFSET, CENTER_X, CENTER_X + LANE_OFFSET];

// Hit zone (invisible, just for logic)
const PLAYER_HIT_Y = TABLE_Y + TABLE_HEIGHT - 50;
const NPC_HIT_Y = TABLE_Y + 50;

// Ball
const BALL_SIZE = 8;
const PHANTOM_BALL_LIFETIME_SEC = 1.1;
const PHANTOM_BALL_FADE_START_SEC = 0.35;

// Colors - Lofi Pixel Art Palette
const COLORS = {
  // Environment
  grass: '#7dae5e',
  grassDark: '#6a9e4e',
  pavement: '#94a1b0',
  pavementDark: '#8390a0',
  fence: '#c0c0c0',
  fenceShadow: '#a0a0a0',
  
  // Table
  table: '#4d80c9',
  tableBorder: '#ffffff',
  tableLines: 'rgba(255, 255, 255, 0.5)',
  net: 'rgba(255, 255, 255, 0.8)',
  netPost: '#333333',
  shadow: 'rgba(0, 0, 0, 0.2)',

  // Characters
  skin: '#f0c0a0',
  playerShirt: '#d05050',
  playerShorts: '#ffffff',
  playerShoes: '#333333',
  npcShirt: '#5050d0',
  npcShorts: '#ffffff',
  npcShoes: '#333333',

  // Note type colors - Bright but soft
  ballNormal: '#ffffff', // White
  ballHold: '#4dd0e1', // Cyan
  ballEcho: '#b39ddb', // Soft purple
  ballSwitch: '#ff7043', // Orange

  // Feedback
  perfect: '#ffeb3b',
  good: '#8bc34a',
  ok: '#4dd0e1',
  miss: '#e57373',
};

// Particle system for floating pollen/leaves
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;     // 0 to 1
  decay: number;    // How fast life decreases
  type: 'dust' | 'explosion';
}

const particles: Particle[] = [];
const PARTICLE_COUNT = 40;

// Initialize dust particles
for (let i = 0; i < PARTICLE_COUNT; i++) {
  particles.push({
    x: Math.random() * CANVAS_WIDTH,
    y: Math.random() * CANVAS_HEIGHT,
    vx: (Math.random() - 0.5) * 0.3,
    vy: Math.random() * 0.2 + 0.1, // Fall down
    size: Math.random() * 2 + 1,
    color: '#ffffc8', // Pollen color
    alpha: Math.random() * 0.3 + 0.3,
    life: Math.random(),
    decay: 0, // Dust doesn't decay linearly, it loops
    type: 'dust'
  });
}

function pseudoRandom01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

function quadraticBezier(p0: number, p1: number, p2: number, t: number): number {
  const inv = 1 - t;
  return inv * inv * p0 + 2 * inv * t * p1 + t * t * p2;
}

function spawnExplosion(x: number, y: number, color: string, count: number = 10) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 100 + 50;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3 + 1,
      color,
      alpha: 1,
      life: 1.0,
      decay: Math.random() * 2.0 + 1.0, // Fast decay
      type: 'explosion'
    });
  }
}

interface ActiveNote extends BeatNote {
  x: number;
  y: number;
  hit: boolean;
  hitResult?: HitResult;
  returnPhase: boolean;
  returnProgress: number;
  spawnTime: number;

  // Initial trajectory
  startX: number;
  targetX: number;
  switchControlX?: number;

  velocityX: number;
  velocityY: number;

  // Return trajectory
  returnStartX?: number;
  returnStartY?: number;

  // For missed ball physics
  missTime?: number;
  missX?: number;
  missY?: number;

  // Hold note state
  holdStartTime?: number; // When player started holding
  holdStartResult?: Exclude<HitResult, 'miss'>;
  holdProgress?: number; // 0-1 progress through hold
  nextHoldTickTime?: number;
  holdTickEverySec?: number;
}

export default function Game({ beatmap, currentTime, isPlaying, onHit }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeNotesRef = useRef<Map<string, ActiveNote>>(new Map());
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastServeTimeRef = useRef<number>(0);
  const isHoldingRef = useRef<boolean>(false);
  const holdingLaneRef = useRef<LaneIndex | null>(null);
  const activeHoldNoteRef = useRef<string | null>(null);

  // Player state for manual movement
  const playerLaneRef = useRef<LaneIndex>(1); // 0=Left, 1=Center, 2=Right

  // Screen shake state
  const shakeRef = useRef<{ x: number; y: number; intensity: number }>({ x: 0, y: 0, intensity: 0 });

  const recordHit = useGameStore((state) => state.recordHit);
  const addPoints = useGameStore((state) => state.addPoints);
  const addHitFeedback = useGameStore((state) => state.addHitFeedback);
  const getGameplaySettings = useGameStore((state) => state.getGameplaySettings);

  // Handle player input (press down)
  const handleInputDown = useCallback((laneIndex: LaneIndex) => {
    if (!isPlaying) return;

    // Get dynamic timing windows from difficulty settings
    const settings = getGameplaySettings();
    const timingWindows = settings.timingWindows;

    // Update player position visually immediately
    playerLaneRef.current = laneIndex;

    isHoldingRef.current = true;
    holdingLaneRef.current = laneIndex;
    const activeNotes = activeNotesRef.current;
    let closestNote: ActiveNote | undefined;
    let closestDelta = Infinity;

    activeNotes.forEach((note) => {
      // Must match lane!
      if (note.hit || note.returnPhase || note.laneIndex !== laneIndex) return;
      // Skip hold notes that are already being held
      if (note.type === 'hold' && note.holdStartTime) return;

      const delta = Math.abs((note.time - currentTime) * 1000);
      const missWindow = (note.type === 'switch' ? 0.75 : 1.0) * timingWindows.miss;

      if (delta < closestDelta && delta < missWindow) {
        closestDelta = delta;
        closestNote = note;
      }
    });

    if (closestNote !== undefined) {
      const note = closestNote;
      const mult = note.type === 'switch' ? 0.75 : 1.0;
      const perfectWindow = timingWindows.perfect * mult;
      const goodWindow = timingWindows.good * mult;
      const okWindow = timingWindows.ok * mult;

      let result: HitResult;
      if (closestDelta <= perfectWindow) {
        result = 'perfect';
      } else if (closestDelta <= goodWindow) {
        result = 'good';
      } else if (closestDelta <= okWindow) {
        result = 'ok';
      } else {
        result = 'miss';
      }

      // Hold notes: start holding instead of instant hit
      if (note.type === 'hold' && result !== 'miss') {
        const holdStartResult = result;
        const beatInterval = 60 / beatmap.timing.bpm;
        const tickEveryBeats = note.holdTickEveryBeats ?? 0.5;
        const tickEverySec = tickEveryBeats * beatInterval;

        note.holdStartTime = currentTime;
        note.holdStartResult = holdStartResult;
        note.holdProgress = 0;
        note.holdTickEverySec = tickEverySec;
        note.nextHoldTickTime = currentTime + tickEverySec;

        activeHoldNoteRef.current = note.id;

        recordHit(result);
        onHit();

        // Don't mark as hit yet - will complete when hold finishes
        addHitFeedback({
          id: note.id + '-start',
          result: holdStartResult,
          x: note.x,
          y: PLAYER_HIT_Y,
          timestamp: Date.now(),
        });
        return;
      }

      // Normal/Strong notes: instant hit
      note.hit = true;
      note.hitResult = result;

      if (result !== 'miss') {
        note.returnPhase = true;
        note.returnProgress = 0;
        // Start return from EXACTLY where it was hit (no snapping)
        note.returnStartX = note.x;
        note.returnStartY = note.y;
        onHit();

        // JUICE: Add shake and explosion on hit
        const isSwitch = note.type === 'switch';
        const intensity = result === 'perfect' ? (isSwitch ? 14 : 10) : (isSwitch ? 8 : 5);
        shakeRef.current.intensity = intensity;

        const explosionColor = isSwitch ? COLORS.ballSwitch : COLORS.perfect;
        const explosionCount = result === 'perfect' ? (isSwitch ? 28 : 20) : (isSwitch ? 16 : 10);

        spawnExplosion(note.x, note.y, explosionColor, explosionCount);
      }

      if (note.type === 'switch' && result !== 'miss') {
        recordHit(result, { pointsMultiplier: 1.15 });
      } else {
        recordHit(result);
      }
      addHitFeedback({
        id: note.id,
        result,
        x: note.x,
        y: PLAYER_HIT_Y,
        timestamp: Date.now(),
      });
    }
  }, [isPlaying, currentTime, recordHit, addHitFeedback, onHit]);

  // Handle player input release (for hold notes)
  const handleInputUp = useCallback((laneIndex: LaneIndex) => {
    isHoldingRef.current = false;
    if (holdingLaneRef.current === laneIndex) {
      holdingLaneRef.current = null;
    }

    // Check if we were holding a note
    if (activeHoldNoteRef.current) {
      const note = activeNotesRef.current.get(activeHoldNoteRef.current);
      
      // Only release if the key matches the note's lane!
      if (note && note.laneIndex === laneIndex) {
        if (note.type === 'hold' && note.holdStartTime && !note.hit) {
          const holdEndTime = note.holdEndTime ?? note.time + 1;

          // Small grace to avoid penalizing release on the final frame.
          if (currentTime < holdEndTime - 0.02) {
            note.hit = true;
            note.hitResult = 'miss';
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            note.velocityX = 0;
            note.velocityY = 250;

            activeHoldNoteRef.current = null;

            recordHit('miss');
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
          return;
        }

        activeHoldNoteRef.current = null;
      }
    }
  }, [currentTime, recordHit, addHitFeedback]);

  // Input handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // Ignore key repeat
      
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        handleInputDown(0);
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        handleInputDown(1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        handleInputDown(2);
      } else if (e.code === 'Space') {
        e.preventDefault();
        // Space hits Center by default? Or assume "last position"?
        // Let's make Space hit Center (1) as a fallback
        handleInputDown(1); 
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        handleInputUp(0);
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        handleInputUp(1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        handleInputUp(2);
      } else if (e.code === 'Space') {
        handleInputUp(1);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        // Simple click mapping based on X position on screen relative to window center?
        // Let's just map click to Center for now to avoid complex coordinate math without rect
        // Or better: map left/right/center of screen width
        const width = window.innerWidth;
        const x = e.clientX;
        if (x < width * 0.33) handleInputDown(0);
        else if (x > width * 0.66) handleInputDown(2);
        else handleInputDown(1);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
        // Same logic for up
        const width = window.innerWidth;
        const x = e.clientX;
        if (x < width * 0.33) handleInputUp(0);
        else if (x > width * 0.66) handleInputUp(2);
        else handleInputUp(1);
    };

    // Touch events similarly
    const handleTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        e.preventDefault();
        const width = window.innerWidth;
        const x = e.touches[0].clientX;
        if (x < width * 0.33) handleInputDown(0);
        else if (x > width * 0.66) handleInputDown(2);
        else handleInputDown(1);
      }
    };

    const handleTouchEnd = () => {
       // Touch end doesn't have coordinates easily, so we might just release all?
       // Simplification: just release center or check changedTouches.
       // For now, let's just trigger release on center as a failsafe or ignore touch specific lane release complexity
       handleInputUp(1);
       handleInputUp(0);
       handleInputUp(2);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleInputDown, handleInputUp]);

  // Game render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;

      const activeNotes = activeNotesRef.current;
      
      // Get dynamic approach time from difficulty settings
      const settings = getGameplaySettings();
      const approachTime = settings.approachTime;

      // Add upcoming notes
      beatmap.notes.forEach((note) => {
        const timeUntil = note.time - currentTime;

        if (timeUntil > 0 && timeUntil <= approachTime && !activeNotes.has(note.id)) {
          const laneIndex = note.laneIndex;

          const randomStart = pseudoRandom01(note.time * 91.7);

          const startX = note.type === 'switch' && note.switchFromLaneIndex !== undefined
            ? LANES[note.switchFromLaneIndex]
            : CENTER_X + (randomStart - 0.5) * 60;

          const targetX = LANES[laneIndex];

          const switchControlX = note.type === 'switch'
            ? CENTER_X + (pseudoRandom01(note.time * 77.7) - 0.5) * 160
            : undefined;

          activeNotes.set(note.id, {
            ...note,
            x: startX,
            y: NPC_HIT_Y,
            hit: false,
            returnPhase: false,
            returnProgress: 0,
            spawnTime: currentTime,
            startX,
            targetX,
            switchControlX,
            velocityX: 0,
            velocityY: 0,
          });

          // Track serve time for NPC animation
          lastServeTimeRef.current = currentTime;
        }
      });

      // Update note positions
      activeNotes.forEach((note, id) => {
        const timeUntil = note.time - currentTime;

        // Handle hold notes being held
        if (note.type === 'hold' && note.holdStartTime && !note.hit) {
          const holdEndTime = note.holdEndTime ?? note.time + 1;
          const holdDuration = Math.max(0.001, holdEndTime - note.holdStartTime);
          const holdElapsed = Math.max(0, currentTime - note.holdStartTime);

          note.holdProgress = Math.min(1, holdElapsed / holdDuration);

          // Keep ball at hit position while holding
          note.x = note.targetX;
          note.y = PLAYER_HIT_Y;

          const beatInterval = 60 / beatmap.timing.bpm;
          const tickEveryBeats = note.holdTickEveryBeats ?? 0.5;
          const tickEverySec = note.holdTickEverySec ?? tickEveryBeats * beatInterval;

          if (note.holdTickEverySec === undefined) {
            note.holdTickEverySec = tickEverySec;
          }

          if (note.nextHoldTickTime === undefined) {
            note.nextHoldTickTime = note.holdStartTime + tickEverySec;
          }

          // Award slider ticks while holding.
          while (
            note.nextHoldTickTime !== undefined &&
            note.nextHoldTickTime <= holdEndTime + 1e-6 &&
            currentTime >= note.nextHoldTickTime
          ) {
            const isHoldingLane = holdingLaneRef.current === note.laneIndex;
            const isHoldingThisNote = activeHoldNoteRef.current === note.id;

            if (isHoldingLane && isHoldingThisNote) {
              addPoints(10);
              note.nextHoldTickTime += tickEverySec;
            } else {
              // Miss a tick => immediate miss (combo breaks)
              note.hit = true;
              note.hitResult = 'miss';
              note.missTime = currentTime;
              note.missX = note.x;
              note.missY = note.y;
              note.velocityX = 0;
              note.velocityY = 250;

              activeHoldNoteRef.current = null;

              recordHit('miss');
              addHitFeedback({
                id: note.id,
                result: 'miss',
                x: note.x,
                y: PLAYER_HIT_Y,
                timestamp: Date.now(),
              });
              break;
            }
          }

          // Check if hold is complete
          if (!note.hit && currentTime >= holdEndTime) {
            note.hit = true;
            note.hitResult = note.holdStartResult ?? 'ok';
            note.returnPhase = true;
            note.returnProgress = 0;
            note.returnStartX = note.x;
            note.returnStartY = note.y;

            activeHoldNoteRef.current = null;

            // Completion juice (no extra scoring)
            spawnExplosion(note.x, note.y, COLORS.ballHold, 12);
          }
        } else if (!note.returnPhase && !note.hit) {
          // Ball traveling from NPC to player - realistic trajectory
          // Allow progress > 1 so it flies past the player if not hit
          const progress = Math.max(0, 1 - (timeUntil / approachTime));

          // X trajectory
          if (note.type === 'switch' && note.switchControlX !== undefined) {
            note.x = quadraticBezier(note.startX, note.switchControlX, note.targetX, progress);
          } else {
            note.x = note.startX + (note.targetX - note.startX) * progress;
          }

          // Parabolic arc for Y
          const arcHeight = 30; // How high the arc goes
          const yBase = NPC_HIT_Y + (PLAYER_HIT_Y - NPC_HIT_Y) * progress;
          const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
          
          // If progress > 1 (missed), decay the arc so it falls naturally
          const finalY = progress > 1 
            ? yBase // Straight line past player
            : yBase - arcOffset;
            
          note.y = finalY;

          // Handle missed notes - mark as missed but DON'T delete
          // Trigger miss slightly later so it flies past paddle first
          if (timeUntil < -0.15 && note.type !== 'hold') {
            note.hit = true;
            note.hitResult = 'miss';
            // Store miss state for physics
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            
            // Calculate velocity to match current movement
            // X velocity is constant
            note.velocityX = (note.targetX - note.startX) / approachTime;
            // Y velocity: It's moving down towards player, plus gravity will take over
            note.velocityY = (PLAYER_HIT_Y - NPC_HIT_Y) / approachTime;
            
            recordHit('miss');
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
          // Hold notes miss if not started in time
          else if (timeUntil < -0.2 && note.type === 'hold' && !note.holdStartTime) {
            note.hit = true;
            note.hitResult = 'miss';
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            note.velocityX = 0;
            note.velocityY = 250;
            recordHit('miss');
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
        } else if (note.hit && note.hitResult === 'miss' && !note.returnPhase && note.missTime !== undefined) {
          // Missed ball continues flying past player using physics
          const timeSinceMiss = currentTime - note.missTime;
          const gravity = 800; // pixels/sec^2

          // Kinematic equations: x = x0 + v*t, y = y0 + v*t + 0.5*g*t^2
          note.x = note.missX! + note.velocityX * timeSinceMiss;
          note.y = note.missY! + note.velocityY * timeSinceMiss + 0.5 * gravity * timeSinceMiss * timeSinceMiss;

          // Keep phantom notes briefly for feedback, then cull.
          if (timeSinceMiss >= PHANTOM_BALL_LIFETIME_SEC || note.y > CANVAS_HEIGHT + 100) {
            activeNotes.delete(id);
            return;
          }
        } else if (note.returnPhase) {
          note.returnProgress += deltaTime * 2.5;

          if (note.returnProgress >= 1) {
            activeNotes.delete(id);
            return;
          }

          // Return arc - ball hit back to NPC
          // Start from WHERE IT WAS HIT, not the player center
          const returnProgress = note.returnProgress;
          const startX = note.returnStartX ?? note.targetX;
          const startY = note.returnStartY ?? PLAYER_HIT_Y;
          const endY = NPC_HIT_Y;

          // Linear Y with arc
          const yBase = startY + (endY - startY) * returnProgress;
          const returnArc = Math.sin(returnProgress * Math.PI) * 40;
          note.y = yBase - returnArc;

          // X goes back towards center (NPC always centered)
          const returnTargetX = CENTER_X;
          note.x = startX + (returnTargetX - startX) * returnProgress;
        }
      });

      // Clear canvas
      ctx.imageSmoothingEnabled = false; // Pixel art look
      
      // Update Shake
      let shakeX = 0;
      let shakeY = 0;
      if (shakeRef.current.intensity > 0) {
        shakeX = (Math.random() - 0.5) * shakeRef.current.intensity;
        shakeY = (Math.random() - 0.5) * shakeRef.current.intensity;
        shakeRef.current.intensity *= 0.9; // Decay
        if (shakeRef.current.intensity < 0.5) shakeRef.current.intensity = 0;
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);

      // Draw scene
      drawBackground(ctx);
      drawTable(ctx);
      
      // Draw 3 Lane Hit Squares
      drawHitSquares(ctx, PLAYER_HIT_Y);

      // Draw characters with animation state
      const npcServeAnim = Math.max(0, 1 - (currentTime - lastServeTimeRef.current) * 5);
      
      // Calculate Player X based on MANUAL input
      const playerX = LANES[playerLaneRef.current];

      drawCharacter(ctx, CENTER_X, NPC_Y, 'npc', npcServeAnim);
      drawCharacter(ctx, playerX, PLAYER_Y, 'player', 0);

      // Draw static hitbox indicator at center - fades with combo
      // const combo = useGameStore.getState().score.combo;
      // drawHitboxIndicator(ctx, CENTER_X, PLAYER_HIT_Y, combo); // Removed in favor of squares

      // Draw balls with effects
      activeNotes.forEach((note) => {
        const isMissed = note.hit && note.hitResult === 'miss';
        const missAgeSec = isMissed && note.missTime !== undefined
          ? Math.max(0, currentTime - note.missTime)
          : 0;
        const missAlpha = isMissed ? getPhantomBallAlpha(missAgeSec) : 1;

        // Draw ball trail for incoming balls (not for hold notes being held)
        if (!note.hit && !note.returnPhase && !note.holdStartTime) {
          drawBallTrail(ctx, note, currentTime, approachTime);
        }

        // Draw hold progress ring if holding
        if (note.type === 'hold' && note.holdStartTime && !note.hit) {
          drawHoldProgress(ctx, note.x, note.y, note.holdProgress || 0);
        }

        // Draw ball (including missed balls flying away)
        drawBall(
          ctx,
          note.x,
          note.y,
          isMissed,
          note.intensity,
          note.returnPhase,
          note.type,
          note.holdStartTime !== undefined,
          missAlpha
        );
      });

      // Hit feedback
      drawHitFeedback(ctx);
      
      ctx.restore(); // Restore translation (end shake)

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentTime, beatmap, isPlaying, recordHit, addHitFeedback]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        cursor: 'pointer',
      }}
    />
  );
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  // Draw tiled pavement
  const TILE_SIZE = 40;
  
  // Grass background (edges)
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Pavement area (center)
  const pavementWidth = CANVAS_WIDTH * 0.8;
  const pavementX = (CANVAS_WIDTH - pavementWidth) / 2;
  
  ctx.fillStyle = COLORS.pavement;
  ctx.fillRect(pavementX, 0, pavementWidth, CANVAS_HEIGHT);

  // Draw tiles
  for (let y = 0; y < CANVAS_HEIGHT; y += TILE_SIZE) {
    for (let x = pavementX; x < pavementX + pavementWidth; x += TILE_SIZE) {
      // Tile borders
      ctx.strokeStyle = COLORS.pavementDark;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
      
      // Random detail pixels for texture
      // We use deterministic positions based on x/y to avoid flickering
      const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      if ((seed - Math.floor(seed)) > 0.8) {
        ctx.fillStyle = COLORS.pavementDark;
        ctx.fillRect(x + 5, y + 5, 4, 4);
      }
    }
  }

  // Draw grass details (simple pixel clusters)
  drawVegetation(ctx, 0, pavementX); // Left side
  drawVegetation(ctx, pavementX + pavementWidth, CANVAS_WIDTH); // Right side

  // Floating particles (pollen/leaves)
  drawParticles(ctx);
}

function drawVegetation(ctx: CanvasRenderingContext2D, startX: number, endX: number) {
  ctx.fillStyle = COLORS.grassDark;
  
  // Deterministic vegetation placement
  for (let y = 20; y < CANVAS_HEIGHT; y += 40) {
    // Generate pseudo-random x based on y
    const rand = Math.abs(Math.sin(y * 12.9898));
    const x = startX + rand * (endX - startX - 20);
    
    if (rand > 0.3) {
      // Draw a little pixel bush (3x3 pixels scaled up)
      const s = 4;
      ctx.fillRect(x, y, s * 3, s * 2);
      ctx.fillRect(x - s, y + s, s * 5, s * 2);
      ctx.fillRect(x, y - s, s * 3, s);
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D) {
  const time = Date.now() / 1000;
  // Use a backward loop to allow removal
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    if (p.type === 'dust') {
      // Dust logic (looping)
      p.x += p.vx + Math.sin(time + p.life * 5) * 0.2;
      p.y += p.vy * 0.5 + 0.2; 

      if (p.y > CANVAS_HEIGHT + 10) {
        p.y = -10;
        p.x = Math.random() * CANVAS_WIDTH;
      }
      if (p.x < -10) p.x = CANVAS_WIDTH + 10;
      if (p.x > CANVAS_WIDTH + 10) p.x = -10;
      
      ctx.fillStyle = `rgba(255, 255, 200, ${p.alpha * 0.8})`;

    } else {
      // Explosion logic (decay and die)
      p.x += p.vx * 0.016; // Assumes 60fps
      p.y += p.vy * 0.016;
      p.life -= p.decay * 0.016;
      
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
    }

    // Draw particle
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.type === 'explosion' ? p.life : 0.8), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawTable(ctx: CanvasRenderingContext2D) {
  // Shadow
  ctx.fillStyle = COLORS.shadow;
  ctx.fillRect(TABLE_X + 10, TABLE_Y + 10, TABLE_WIDTH, TABLE_HEIGHT);

  // Table surface
  ctx.fillStyle = COLORS.table;
  ctx.fillRect(TABLE_X, TABLE_Y, TABLE_WIDTH, TABLE_HEIGHT);

  // White border lines
  ctx.strokeStyle = COLORS.tableBorder;
  ctx.lineWidth = 4;
  ctx.strokeRect(TABLE_X, TABLE_Y, TABLE_WIDTH, TABLE_HEIGHT);

  // Center line vertical
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.tableLines;
  ctx.beginPath();
  ctx.moveTo(CENTER_X, TABLE_Y);
  ctx.lineTo(CENTER_X, TABLE_Y + TABLE_HEIGHT);
  ctx.stroke();

  // Net
  const netY = TABLE_Y + TABLE_HEIGHT / 2;
  
  // Net posts
  ctx.fillStyle = COLORS.netPost;
  ctx.fillRect(TABLE_X - 5, netY - 5, 5, 10);
  ctx.fillRect(TABLE_X + TABLE_WIDTH, netY - 5, 5, 10);

  // Net mesh
  ctx.fillStyle = COLORS.net;
  // Draw detailed net pattern (checkered)
  const netHeight = 12;
  ctx.fillRect(TABLE_X, netY - netHeight/2, TABLE_WIDTH, netHeight);
  
  // Net crosshatch
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = TABLE_X; x <= TABLE_X + TABLE_WIDTH; x += 4) {
    ctx.moveTo(x, netY - netHeight/2);
    ctx.lineTo(x, netY + netHeight/2);
  }
  for (let y = netY - netHeight/2; y <= netY + netHeight/2; y += 4) {
    ctx.moveTo(TABLE_X, y);
    ctx.lineTo(TABLE_X + TABLE_WIDTH, y);
  }
  ctx.stroke();
  
  // Top of net (white line)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(TABLE_X, netY - netHeight/2, TABLE_WIDTH, 2);
}

function drawHitSquares(ctx: CanvasRenderingContext2D, y: number) {
  const size = 30;
  const padding = 10;
  
  // Draw the 3 squares
  LANES.forEach((x) => {
    // Square background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(x - size/2, y - size/2, size, size);
    
    // White border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - size/2, y - size/2, size, size);
    
    // Center dot (yellow)
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  });
  
  // Draw Timing Line (Finish Line) across all 3 squares
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Line goes through the center of all squares
  const startX = LANES[0] - size/2 - padding;
  const endX = LANES[2] + size/2 + padding;
  ctx.moveTo(startX, y);
  ctx.lineTo(endX, y);
  ctx.stroke();
}

// Replaced drawHitboxIndicator with drawHitSquares above

function drawBallTrail(ctx: CanvasRenderingContext2D, note: ActiveNote, currentTime: number, approachTime: number) {
  const trailLength = 5;
  const timeUntil = note.time - currentTime;
  const progress = Math.max(0, Math.min(1, 1 - (timeUntil / approachTime)));

  const trailColors: Record<NoteType, { r: number; g: number; b: number }> = {
    normal: { r: 255, g: 255, b: 255 },
    hold: { r: 77, g: 208, b: 225 },
    echo: { r: 179, g: 157, b: 219 },
    switch: { r: 255, g: 112, b: 67 },
  };
  const trailColor = trailColors[note.type];

  for (let i = trailLength; i > 0; i--) {
    const trailProgress = Math.max(0, progress - i * 0.03);
    if (trailProgress <= 0) continue;

    const trailX = note.startX + (note.targetX - note.startX) * trailProgress;
    const arcHeight = 30;
    const yBase = NPC_HIT_Y + (PLAYER_HIT_Y - NPC_HIT_Y) * trailProgress;
    const arcOffset = Math.sin(trailProgress * Math.PI) * arcHeight;
    const trailY = yBase - arcOffset;

    const alpha = (1 - i / trailLength) * 0.2;
    const size = BALL_SIZE * (1 - i / trailLength) * 0.6;

    ctx.beginPath();
    ctx.arc(trailX, trailY, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${trailColor.r}, ${trailColor.g}, ${trailColor.b}, ${alpha})`;
    ctx.fill();
  }
}

function drawHoldProgress(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number) {
  const radius = 25;

  // Background ring
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Progress ring
  ctx.beginPath();
  ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.strokeStyle = COLORS.ballHold;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function getPhantomBallAlpha(timeSinceMiss: number): number {
  if (timeSinceMiss <= PHANTOM_BALL_FADE_START_SEC) return 0.55;

  const fadeDuration = PHANTOM_BALL_LIFETIME_SEC - PHANTOM_BALL_FADE_START_SEC;
  if (fadeDuration <= 0) return 0.55;

  const fadeProgress = Math.min(1, (timeSinceMiss - PHANTOM_BALL_FADE_START_SEC) / fadeDuration);
  return 0.55 * (1 - fadeProgress);
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isMiss: boolean,
  intensity: number,
  isReturn: boolean,
  noteType: NoteType = 'normal',
  isHolding: boolean = false,
  missAlpha: number = 0.55
) {
  if (isMiss) {
    ctx.globalAlpha = missAlpha;
  }

  // Size varies by note type
  let size = BALL_SIZE * (0.9 + intensity * 0.2);
  if (noteType === 'hold') size *= 1.1;
  if (isHolding) size *= 1.2;

  // Ball shadow (on the ground)
  if (!isMiss && !isReturn) {
    // Determine shadow Y based on "ground" logic
    // The shadow simply moves linearly from NPC_HIT_Y to PLAYER_HIT_Y
    // We can re-calculate the linear progress to place the shadow
    // But since we don't pass progress here, we'll approximate:
    // Shadow is always "below" the ball, but when the ball arcs high, the shadow stays low.
    // Actually, we should calculate the shadow position in the update loop or pass it here.
    // For now, let's just draw a simple shadow slightly below the ball, 
    // BUT strictly speaking for 3D feel, the shadow should be at the "table surface" Y.
    // Let's cheat slightly: shadow offset grows as ball arcs up.
    
    // We can infer arc height by checking distance to center of travel?
    // Let's keep it simple for pixel art style:
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    // Shadow is always a flat ellipse
    // As ball goes higher (smaller Y), shadow distance increases
    // This is hard to do perfectly without 3D state. 
    // Let's just put it at a fixed offset + some "fake height" logic isn't worth it without state.
    // STICK TO: Shadow is just below the ball for now, but distinct.
    ctx.ellipse(x, y + size + 8, size, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main ball - white with colored outline based on note type
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  const fillColors: Record<NoteType, string> = {
    normal: '#ffffff',
    hold: '#d9f8ff',
    echo: '#efe7ff',
    switch: '#ffe3d9',
  };
  ctx.fillStyle = isMiss ? '#f4f4f4' : fillColors[noteType];
  ctx.fill();
  
  // Outline for note types
  const strokeColors: Record<NoteType, string> = {
    normal: 'rgba(0, 0, 0, 0.25)',
    hold: COLORS.ballHold,
    echo: COLORS.ballEcho,
    switch: COLORS.ballSwitch,
  };
  ctx.strokeStyle = isMiss ? COLORS.miss : strokeColors[noteType];
  ctx.lineWidth = noteType === 'normal' ? 2 : 2.5;
  ctx.stroke();

  // Subtle highlight
  ctx.beginPath();
  ctx.arc(x - size * 0.3, y - size * 0.3, size * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fill();

  ctx.globalAlpha = 1;
}

function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, type: 'player' | 'npc', swingAnim: number = 0) {
  const isPlayer = type === 'player';
  const shirtColor = isPlayer ? COLORS.playerShirt : COLORS.npcShirt;
  const shortsColor = isPlayer ? COLORS.playerShorts : COLORS.npcShorts;
  
  const scale = 3; // Pixel scale

  // Shadow
  ctx.fillStyle = COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Adjust Y to center the character sprite on the point
  const drawY = y - 20;

  // Legs (Skin)
  ctx.fillStyle = COLORS.skin;
  ctx.fillRect(x - 3 * scale, drawY + 8 * scale, 2 * scale, 4 * scale); // Left leg
  ctx.fillRect(x + 1 * scale, drawY + 8 * scale, 2 * scale, 4 * scale); // Right leg
  
  // Shorts
  ctx.fillStyle = shortsColor;
  ctx.fillRect(x - 3 * scale, drawY + 5 * scale, 2.5 * scale, 3 * scale);
  ctx.fillRect(x + 0.5 * scale, drawY + 5 * scale, 2.5 * scale, 3 * scale);

  // Body (Shirt)
  ctx.fillStyle = shirtColor;
  ctx.fillRect(x - 3 * scale, drawY + 1 * scale, 6 * scale, 4 * scale);
  
  // Head (Skin)
  ctx.fillStyle = COLORS.skin;
  ctx.fillRect(x - 2 * scale, drawY - 3 * scale, 4 * scale, 4 * scale);
  
  // Hair (Dark brown)
  ctx.fillStyle = '#3e2723';
  ctx.fillRect(x - 2.5 * scale, drawY - 4 * scale, 5 * scale, 2 * scale); // Top
  ctx.fillRect(x - 2.5 * scale, drawY - 2 * scale, 1 * scale, 2 * scale); // Side burns
  ctx.fillRect(x + 1.5 * scale, drawY - 2 * scale, 1 * scale, 2 * scale);

  // Paddle Arm
  const swingOffset = swingAnim * 10;
  const armX = x + 3 * scale;
  
  // Arm
  ctx.fillStyle = COLORS.skin;
  ctx.fillRect(armX, drawY + 1 * scale, 4 * scale, 1.5 * scale); // Upper arm

  // Paddle
  ctx.fillStyle = '#333'; // Handle
  ctx.fillRect(armX + 4 * scale + swingOffset, drawY, 1 * scale, 3 * scale);
  ctx.fillStyle = '#d32f2f'; // Face
  ctx.beginPath();
  ctx.arc(armX + 4.5 * scale + swingOffset, drawY - 2 * scale, 2.5 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawHitFeedback(ctx: CanvasRenderingContext2D) {
  const feedbacks = useGameStore.getState().hitFeedbacks;
  const now = Date.now();

  feedbacks.forEach((feedback) => {
    const age = now - feedback.timestamp;
    if (age > 500) return;

    const alpha = 1 - age / 500;
    const yOffset = age / 6;

    const colors: Record<HitResult, string> = {
      perfect: COLORS.perfect,
      good: COLORS.good,
      ok: COLORS.ok,
      miss: COLORS.miss,
    };

    const labels: Record<HitResult, string> = {
      perfect: 'PERFECT',
      good: 'GOOD',
      ok: 'OK',
      miss: 'MISS',
    };

    ctx.globalAlpha = alpha;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    
    // Stroke text for readability against pavement
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(labels[feedback.result], feedback.x, feedback.y - yOffset - 35);

    ctx.fillStyle = colors[feedback.result];
    ctx.fillText(labels[feedback.result], feedback.x, feedback.y - yOffset - 35);

    ctx.globalAlpha = 1;
  });

  useGameStore.getState().clearOldFeedbacks();
}
