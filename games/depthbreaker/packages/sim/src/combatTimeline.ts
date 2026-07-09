export type CombatActionState = "idle" | "attack" | "skill" | "hit" | "dying" | "dead";

export interface TimedCombatAction {
  state: CombatActionState;
  startedAt: number;
  endsAt: number;
  targetId: string;
  actionId: string;
}

export interface CombatActionSnapshot {
  actionState: CombatActionState;
  actionId: string;
  actionEndsAt: number;
}

export interface AttackTiming {
  windup: number;
  recovery: number;
}

export interface ProjectileTiming {
  launchDelay: number;
  travelTime: number;
  impactDelay: number;
}

export interface ProjectileEntity {
  id: string;
  x: number;
  z: number;
  alive: boolean;
}

export interface PendingProjectile<TPayload = unknown> {
  actionId: string;
  sourceId: string;
  targetId: string;
  x: number;
  z: number;
  ttl: number;
  payload: TPayload;
}

export interface ProjectileAdvanceResult<TPayload = unknown> {
  remaining: PendingProjectile<TPayload>[];
  impacts: PendingProjectile<TPayload>[];
  fizzled: PendingProjectile<TPayload>[];
}

export const DEFAULT_MELEE_ATTACK_TIMING: AttackTiming = {
  windup: 0.25,
  recovery: 0.35,
};

export const DEFAULT_ENEMY_ATTACK_TIMING: AttackTiming = {
  windup: 0.32,
  recovery: 0.35,
};

export const DEFAULT_SKILL_TIMING: AttackTiming = {
  windup: 0.18,
  recovery: 0.42,
};

export const PROJECTILE_SPEED_UNITS_PER_SECOND = 28;
export const PROJECTILE_MAX_FLIGHT_SECONDS = 1.2;
export const PROJECTILE_REACH_UNITS = 0.7;
export const ENEMY_DYING_SECONDS = 1.4;

export function actionDuration(timing: AttackTiming): number {
  return timing.windup + timing.recovery;
}

export function makeTimedAction(
  state: CombatActionState,
  now: number,
  duration: number,
  targetId: string,
  actionId: string,
): TimedCombatAction {
  return {
    state,
    startedAt: now,
    endsAt: now + Math.max(0, duration),
    targetId,
    actionId,
  };
}

export function isCombatActionCurrent(
  action: CombatActionSnapshot,
  actionId: string,
  now: number,
): boolean {
  return (
    action.actionId === actionId &&
    action.actionState !== "idle" &&
    action.actionState !== "dead" &&
    now <= action.actionEndsAt
  );
}

export function projectileTiming(
  distance: number,
  launchDelay = DEFAULT_MELEE_ATTACK_TIMING.windup,
  speed = PROJECTILE_SPEED_UNITS_PER_SECOND,
  maxFlight = PROJECTILE_MAX_FLIGHT_SECONDS,
): ProjectileTiming {
  const safeSpeed = Math.max(0.001, speed);
  const travelTime = Math.min(maxFlight, Math.max(0, distance) / safeSpeed);
  return {
    launchDelay,
    travelTime,
    impactDelay: launchDelay + travelTime,
  };
}

export function createPendingProjectile<TPayload>(
  actionId: string,
  source: ProjectileEntity,
  target: ProjectileEntity,
  payload: TPayload,
  ttl = PROJECTILE_MAX_FLIGHT_SECONDS,
): PendingProjectile<TPayload> {
  return {
    actionId,
    sourceId: source.id,
    targetId: target.id,
    x: source.x,
    z: source.z,
    ttl,
    payload,
  };
}

export function stepProjectile(
  x: number,
  z: number,
  targetX: number,
  targetZ: number,
  step: number,
  reach = PROJECTILE_REACH_UNITS,
): { x: number; z: number; hit: boolean } {
  const dx = targetX - x;
  const dz = targetZ - z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= Math.max(reach, step)) return { x: targetX, z: targetZ, hit: true };
  const k = step / Math.max(0.001, dist);
  return { x: x + dx * k, z: z + dz * k, hit: false };
}

export function advancePendingProjectiles<TPayload>(
  projectiles: readonly PendingProjectile<TPayload>[],
  dt: number,
  resolveEntity: (id: string) => ProjectileEntity | undefined,
  speed = PROJECTILE_SPEED_UNITS_PER_SECOND,
  reach = PROJECTILE_REACH_UNITS,
): ProjectileAdvanceResult<TPayload> {
  const remaining: PendingProjectile<TPayload>[] = [];
  const impacts: PendingProjectile<TPayload>[] = [];
  const fizzled: PendingProjectile<TPayload>[] = [];
  const step = Math.max(0, dt) * Math.max(0.001, speed);

  for (const projectile of projectiles) {
    const source = resolveEntity(projectile.sourceId);
    const target = resolveEntity(projectile.targetId);
    if (!source?.alive || !target?.alive) {
      fizzled.push(projectile);
      continue;
    }

    const next = stepProjectile(projectile.x, projectile.z, target.x, target.z, step, reach);
    const updated = { ...projectile, x: next.x, z: next.z, ttl: projectile.ttl - Math.max(0, dt) };
    if (next.hit || updated.ttl <= 0) impacts.push(updated);
    else remaining.push(updated);
  }

  return { remaining, impacts, fizzled };
}

export function advanceTimer(seconds: number, dt: number): number {
  return Math.max(0, seconds - Math.max(0, dt));
}
