import { describe, expect, it } from "vitest";
import {
  DEFAULT_MELEE_ATTACK_TIMING,
  ENEMY_DYING_SECONDS,
  actionDuration,
  advancePendingProjectiles,
  advanceTimer,
  createPendingProjectile,
  isCombatActionCurrent,
  makeTimedAction,
  projectileTiming,
} from "../combatTimeline.js";

describe("combatTimeline", () => {
  it("places melee impact inside a fixed action window", () => {
    const duration = actionDuration(DEFAULT_MELEE_ATTACK_TIMING);
    const action = makeTimedAction("attack", 10, duration, "enemy-1", "a1");
    expect(action.startedAt).toBe(10);
    expect(action.endsAt).toBeCloseTo(10.6);
    expect(DEFAULT_MELEE_ATTACK_TIMING.windup).toBeCloseTo(0.25);
  });

  it("computes projectile impact timing from launch delay and distance", () => {
    const timing = projectileTiming(28, 0.25, 28, 1.2);
    expect(timing.launchDelay).toBeCloseTo(0.25);
    expect(timing.travelTime).toBeCloseTo(1);
    expect(timing.impactDelay).toBeCloseTo(1.25);
  });

  it("caps projectile flight and advances death timers", () => {
    expect(projectileTiming(999, 0.25, 28, 1.2).impactDelay).toBeCloseTo(1.45);
    expect(advanceTimer(ENEMY_DYING_SECONDS, 0.5)).toBeCloseTo(0.9);
    expect(advanceTimer(0.2, 0.5)).toBe(0);
  });

  it("advances a homing projectile to a moving target", () => {
    const source = { id: "p1", x: 0, z: 0, alive: true };
    const target = { id: "e1", x: 8, z: 0, alive: true };
    const projectile = createPendingProjectile("a1", source, target, "payload", 3);
    const first = advancePendingProjectiles([projectile], 0.1, (id) => (id === "p1" ? source : target), 10, 0.2);
    expect(first.impacts).toHaveLength(0);
    expect(first.remaining[0]?.x).toBeCloseTo(1);

    target.x = 1.5;
    const second = advancePendingProjectiles(first.remaining, 0.1, (id) => (id === "p1" ? source : target), 10, 0.6);
    expect(second.impacts).toHaveLength(1);
    expect(second.impacts[0]?.payload).toBe("payload");
  });

  it("fizzles projectiles when either endpoint is dead", () => {
    const source = { id: "p1", x: 0, z: 0, alive: true };
    const target = { id: "e1", x: 8, z: 0, alive: false };
    const projectile = createPendingProjectile("a1", source, target, null, 3);
    const result = advancePendingProjectiles([projectile], 0.1, (id) => (id === "p1" ? source : target));
    expect(result.fizzled).toHaveLength(1);
    expect(result.remaining).toHaveLength(0);
  });

  it("rejects stale combat actions", () => {
    expect(isCombatActionCurrent({ actionState: "attack", actionId: "a1", actionEndsAt: 2 }, "a1", 1)).toBe(true);
    expect(isCombatActionCurrent({ actionState: "idle", actionId: "a1", actionEndsAt: 2 }, "a1", 1)).toBe(false);
    expect(isCombatActionCurrent({ actionState: "attack", actionId: "a2", actionEndsAt: 2 }, "a1", 1)).toBe(false);
    expect(isCombatActionCurrent({ actionState: "attack", actionId: "a1", actionEndsAt: 2 }, "a1", 3)).toBe(false);
  });
});
