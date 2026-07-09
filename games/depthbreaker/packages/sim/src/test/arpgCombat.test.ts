import { describe, expect, it } from "vitest";
import {
  ARPG_CLASS_DEFS,
  applySkillImpact,
  canCastSkill,
  createArpgPlayerActor,
  cycleArpgTarget,
  isArpgWalkable,
  moveArpgActorToward,
  nearestWalkablePoint,
  resolveArpgAutoAttackIntent,
  startSkill,
  type ArpgActorState,
} from "../arpgCombat.js";
import { createArpgInventory } from "../arpgMvp.js";

function enemy(id = "enemy", hp = 100): ArpgActorState {
  return {
    id,
    kind: "enemy",
    enemyRank: "common",
    x: 8,
    y: 7,
    hp,
    maxHp: hp,
    resource: 0,
    maxResource: 0,
    resourceKind: "rage",
    baseDamage: 6,
    attackRange: 1.2,
    moveSpeed: 2,
    mode: "idle",
    targetId: null,
    cooldowns: {},
    buffs: [],
    action: null,
  };
}

describe("arpgCombat map", () => {
  it("connects town, road, farm, elite and boss areas", () => {
    expect(isArpgWalkable(7, 7)).toBe(true);
    expect(isArpgWalkable(17, 11)).toBe(true);
    expect(isArpgWalkable(17, 18)).toBe(true);
    expect(isArpgWalkable(17, 26)).toBe(true);
    expect(isArpgWalkable(17, 31)).toBe(true);
  });

  it("projects blocked clicks to the nearest walkable point", () => {
    const p = nearestWalkablePoint({ x: 0, y: 18 });
    expect(isArpgWalkable(p.x, p.y)).toBe(true);
    expect(p.x).toBe(5);
  });

  it("moves actors precisely toward a projected walkable target", () => {
    const actor = createArpgPlayerActor("p", "bruiser");
    const target = nearestWalkablePoint({ x: 99, y: 99 });
    const moved = moveArpgActorToward(actor, target, 0.25);
    expect(isArpgWalkable(moved.position.x, moved.position.y)).toBe(true);
    expect(moved.position.x).toBeGreaterThan(actor.x);
    expect(moved.arrived).toBe(false);
  });
});

describe("arpgCombat skills", () => {
  for (const classId of ["bruiser", "mage", "warden"] as const) {
    it(`${classId} can start basic and Q/W/E/R when requirements are met`, () => {
      const actor = createArpgPlayerActor("p", classId);
      actor.resource = actor.maxResource;
      const target = enemy();
      for (const slot of ["basic", "q", "w", "e", "r"] as const) {
        actor.action = null;
        actor.cooldowns = {};
        const def = ARPG_CLASS_DEFS[classId].skills[slot];
        const point = def.targeting === "area" || def.targeting === "dash" ? { x: target.x, y: target.y } : undefined;
        expect(canCastSkill(actor, def, 0, target, point).ok).toBe(true);
      }
    });
  }

  it("blocks recast during cooldown and applies damage only on impact", () => {
    const actor = createArpgPlayerActor("p", "mage");
    const target = enemy();
    const skill = ARPG_CLASS_DEFS.mage.skills.q;
    startSkill(actor, skill, 100, target);
    expect(canCastSkill(actor, skill, 200, target).ok).toBe(false);
    expect(applySkillImpact(actor, skill, [target], 300, createArpgInventory("mage"))).toEqual([]);
    const events = applySkillImpact(actor, skill, [target], 550, createArpgInventory("mage"));
    expect(events.some((event) => event.type === "damage")).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("prevents dead actors from casting", () => {
    const actor = createArpgPlayerActor("p", "bruiser");
    actor.hp = 0;
    actor.mode = "dead";
    expect(canCastSkill(actor, ARPG_CLASS_DEFS.bruiser.skills.basic, 0, enemy()).ok).toBe(false);
  });

  it("boss phases advance by hp percentage", () => {
    const actor = createArpgPlayerActor("p", "bruiser");
    actor.resource = actor.maxResource;
    const boss = enemy("boss", 100);
    boss.enemyRank = "boss";
    boss.bossPhase = 1;
    boss.hp = 60;
    const skill = ARPG_CLASS_DEFS.bruiser.skills.q;
    startSkill(actor, skill, 0, boss);
    const events = applySkillImpact(actor, skill, [boss], 500, createArpgInventory("bruiser"));
    expect(events.some((event) => event.type === "phase")).toBe(true);
  });

  it("cycles tab targeting by nearest live targets inside range", () => {
    const actor = createArpgPlayerActor("p", "mage");
    const close = enemy("close");
    close.x = actor.x + 2;
    close.y = actor.y;
    const far = enemy("far");
    far.x = actor.x + 4;
    far.y = actor.y;
    const outside = enemy("outside");
    outside.x = actor.x + 20;
    outside.y = actor.y;

    expect(cycleArpgTarget(actor, [far, outside, close], null, 9)?.id).toBe("close");
    expect(cycleArpgTarget(actor, [far, outside, close], "close", 9)?.id).toBe("far");
  });

  it("auto-combat selects aggroed enemies, chases into range and attacks when ready", () => {
    const actor = createArpgPlayerActor("p", "bruiser");
    const target = enemy("aggro");
    target.x = actor.x + 3;
    target.y = actor.y;
    const basic = ARPG_CLASS_DEFS.bruiser.skills.basic;

    expect(resolveArpgAutoAttackIntent(actor, basic, [target], null, ["aggro"], 0)).toEqual({ type: "select", targetId: "aggro" });
    expect(resolveArpgAutoAttackIntent(actor, basic, [target], "aggro", ["aggro"], 0)).toMatchObject({ type: "chase", targetId: "aggro" });
    target.x = actor.x + 1;
    expect(resolveArpgAutoAttackIntent(actor, basic, [target], "aggro", ["aggro"], 0)).toEqual({ type: "attack", targetId: "aggro" });
  });
});
