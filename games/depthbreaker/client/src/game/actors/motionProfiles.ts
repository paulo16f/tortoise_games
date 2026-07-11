export type MotionProfileId = "humanoidPlayer" | "lightEnemy" | "eliteEnemy" | "heavyBoss";

/**
 * Per-archetype tuning for the active V1 animation system. The renderer
 * smooths server transforms; locomotion uses only approved forward idle/walk/run
 * clips plus attack/hit/death one-shots.
 */
export interface MotionProfile {
  id: MotionProfileId;
  turnLerp: number;
  positionLerp: number;
  positionSnapDistance: number;
  moveEnterSpeed: number;
  blendRate: number;
  fallbackNatural: { walk: number; run: number };
  attackLockMs: number;
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
    fallbackNatural: { walk: 1.46, run: 2.6 },
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
    fallbackNatural: { walk: 1.46, run: 2.6 },
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
    fallbackNatural: { walk: 1.4, run: 2.5 },
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
    fallbackNatural: { walk: 1.25, run: 2.1 },
    attackLockMs: 300,
    fadeMs: 160,
  },
};

export const DEFAULT_MOTION_PROFILE = MOTION_PROFILES.humanoidPlayer;
