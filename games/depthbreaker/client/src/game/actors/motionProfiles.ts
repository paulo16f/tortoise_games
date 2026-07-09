export type MotionProfileId = "humanoidPlayer" | "lightEnemy" | "eliteEnemy" | "heavyBoss";

/**
 * Per-archetype tuning for the Polygon-based locomotion system. The renderer
 * (Player/Enemy) uses `positionLerp`/`turnLerp` to smooth the server transform;
 * everything else feeds the client-side locomotion blend (locomotionController).
 */
export interface MotionProfile {
  id: MotionProfileId;

  // --- Rendered-transform smoothing (Player.tsx / Enemy.tsx) ---
  turnLerp: number;
  positionLerp: number;
  positionSnapDistance: number;

  // --- Locomotion speed blend + foot-lock (locomotionController) ---
  /** u/s below which the entity is treated as standing (idle floor). */
  moveEnterSpeed: number;
  /** Per-second easing rate for locomotion clip cross-weighting. */
  blendRate: number;
  /** Clamp on foot-lock playback rate so extreme speeds don't look silly. */
  footLockMin: number;
  footLockMax: number;
  /** Natural ground speed (m/s) of each looping clip, used only when the GLB
   * has no measured `strideNorm` (see runtime manifest). Values are for a
   * ~1.8m humanoid; the controller rescales by the character's visualHeight. */
  fallbackNatural: { walk: number; run: number; sprint: number };

  // --- One-shot transitions ---
  enableStartStop: boolean;
  enableTurnInPlace: boolean;
  /** u/s at/above which start & stop use the run (not walk) transition. */
  runStartSpeed: number;
  /** rad/s of body yaw above which a standing entity plays turn-in-place. */
  turnRateEnter: number;

  // --- Combat overlay ---
  attackLockMs: number;
  /** Cross-fade time (ms) into/out of one-shot combat & transition clips. */
  fadeMs: number;
}

export const MOTION_PROFILES: Record<MotionProfileId, MotionProfile> = {
  humanoidPlayer: {
    id: "humanoidPlayer",
    turnLerp: 18,
    positionLerp: 18,
    positionSnapDistance: 4.5,
    moveEnterSpeed: 0.35,
    blendRate: 11,
    footLockMin: 0.6,
    footLockMax: 1.7,
    fallbackNatural: { walk: 1.46, run: 2.6, sprint: 7.28 },
    enableStartStop: false,
    enableTurnInPlace: false,
    runStartSpeed: 2.6,
    turnRateEnter: 1.7,
    attackLockMs: 180,
    fadeMs: 110,
  },
  lightEnemy: {
    id: "lightEnemy",
    turnLerp: 17,
    positionLerp: 17,
    positionSnapDistance: 4.5,
    moveEnterSpeed: 0.35,
    blendRate: 10,
    footLockMin: 0.6,
    footLockMax: 1.7,
    fallbackNatural: { walk: 1.46, run: 2.6, sprint: 7.28 },
    enableStartStop: false,
    enableTurnInPlace: false,
    runStartSpeed: 2.4,
    turnRateEnter: 2.0,
    attackLockMs: 170,
    fadeMs: 120,
  },
  eliteEnemy: {
    id: "eliteEnemy",
    turnLerp: 14,
    positionLerp: 15,
    positionSnapDistance: 5,
    moveEnterSpeed: 0.3,
    blendRate: 8,
    footLockMin: 0.55,
    footLockMax: 1.6,
    fallbackNatural: { walk: 1.4, run: 2.5, sprint: 6.8 },
    enableStartStop: false,
    enableTurnInPlace: false,
    runStartSpeed: 2.2,
    turnRateEnter: 2.0,
    attackLockMs: 220,
    fadeMs: 135,
  },
  heavyBoss: {
    id: "heavyBoss",
    turnLerp: 10,
    positionLerp: 12,
    positionSnapDistance: 6,
    moveEnterSpeed: 0.28,
    blendRate: 6,
    footLockMin: 0.5,
    footLockMax: 1.45,
    fallbackNatural: { walk: 1.25, run: 2.1, sprint: 5.5 },
    enableStartStop: false,
    enableTurnInPlace: false,
    runStartSpeed: 1.9,
    turnRateEnter: 2.2,
    attackLockMs: 300,
    fadeMs: 160,
  },
};

export const DEFAULT_MOTION_PROFILE = MOTION_PROFILES.humanoidPlayer;
