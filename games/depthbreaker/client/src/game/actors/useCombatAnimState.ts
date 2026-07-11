import { useEffect, useRef } from "react";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";

import type { MotionProfile } from "./motionProfiles";
import { DEFAULT_MOTION_PROFILE } from "./motionProfiles";
import type { LocoInputs } from "./locomotionController";
import type { LocomotionSample } from "./useLocomotion";

const HIT_CLIP_MS = 350;
const DEFAULT_ATTACK_DURATION_MS = 400;
const YAW_SMOOTH_RATE = 10;

/**
 * Derives one frame of motion inputs for the locomotion controller. Combat
 * windows come from server `actionState` plus combatBus event timing; movement
 * speed/`moving` are supplied by the caller (useLocomotion, derived from the
 * rendered mesh's own interpolated position); body yaw-rate is derived here
 * from the server yaw for turn-in-place. Call `update(delta, loco)` once per
 * frame so the consumer can fold it into its own useFrame pass.
 */
export function useCombatAnimState(
  entityId: string,
  kind: "player" | "enemy",
  attackDurationMs: number = DEFAULT_ATTACK_DURATION_MS,
  _profile: MotionProfile = DEFAULT_MOTION_PROFILE,
) {
  const attackUntil = useRef(0);
  const hitUntil = useRef(0);
  const prevYaw = useRef<number | null>(null);
  const smoothYawRate = useRef(0);

  useEffect(() => {
    return combatBus.subscribe((f) => {
      const damaging = f.kind === "hit" || f.kind === "crit" || (f.kind === "skill" && f.amount > 0);
      if (!damaging) return;
      if (f.sourceId === entityId) attackUntil.current = performance.now() + f.delayMs + attackDurationMs;
      if (f.targetId === entityId) hitUntil.current = performance.now() + f.delayMs + HIT_CLIP_MS;
    });
  }, [entityId, attackDurationMs]);

  const update = (delta: number, loco: LocomotionSample): LocoInputs | null => {
    const st = zoneStore.state;
    const e = kind === "player" ? st?.players.get(entityId) : st?.enemies.get(entityId);
    if (!e) return null;

    // Smoothed signed body yaw-rate (rad/s) for turn-in-place detection.
    let yawRate = 0;
    if (prevYaw.current !== null && delta > 1e-4) {
      let diff = (e.yaw - prevYaw.current) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      yawRate = diff / delta;
    }
    prevYaw.current = e.yaw;
    smoothYawRate.current += (yawRate - smoothYawRate.current) * Math.min(1, delta * YAW_SMOOTH_RATE);

    const base = { speed: loco.speed, moving: loco.moving, backwards: loco.backwards, yawRate: smoothYawRate.current };

    if (e.actionState === "dying" || e.actionState === "dead" || !e.alive) {
      return { ...base, combat: { kind: "death", actionId: e.actionId }, alive: false };
    }
    if (e.actionState === "attack" || e.actionState === "skill") {
      return { ...base, combat: { kind: "attack", actionId: e.actionId }, alive: true };
    }
    if (e.actionState === "hit") {
      return { ...base, combat: { kind: "hit", actionId: e.actionId }, alive: true };
    }

    const now = performance.now();
    if (now < attackUntil.current) return { ...base, combat: { kind: "attack", actionId: e.actionId }, alive: true };
    if (now < hitUntil.current) return { ...base, combat: { kind: "hit", actionId: e.actionId }, alive: true };

    return { ...base, combat: null, alive: true };
  };

  return { update };
}
