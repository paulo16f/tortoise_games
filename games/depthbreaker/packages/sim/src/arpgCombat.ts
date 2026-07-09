import type { ArpgClassId, ArpgEnemyRank, ArpgInventoryState } from "./arpgMvp.js";
import { arpgWeaponAttack } from "./arpgMvp.js";

export type ArpgActorKind = "player" | "enemy";
export type ArpgActorMode = "idle" | "moving" | "basic" | "casting" | "channeling" | "recovery" | "hit" | "dead";
export type ArpgSkillSlot = "basic" | "q" | "w" | "e" | "r";
export type ArpgTargeting = "target" | "self" | "area" | "dash";
export type ArpgResourceKind = "rage" | "mana" | "spirit";
export type ArpgBuffKind = "damageReduction" | "damageBoost" | "slow" | "root" | "guardian";

export interface ArpgVec2 {
  x: number;
  y: number;
}

export interface ArpgRect {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ArpgBuff {
  id: string;
  kind: ArpgBuffKind;
  value: number;
  expiresAtMs: number;
}

export interface ArpgCombatAction {
  skillId: string;
  startedAtMs: number;
  impactAtMs: number;
  endsAtMs: number;
  targetId?: string;
  point?: ArpgVec2;
  impacted: boolean;
}

export interface ArpgActorState {
  id: string;
  kind: ArpgActorKind;
  classId?: ArpgClassId;
  enemyRank?: ArpgEnemyRank;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  resourceKind: ArpgResourceKind;
  baseDamage: number;
  attackRange: number;
  moveSpeed: number;
  mode: ArpgActorMode;
  targetId: string | null;
  cooldowns: Partial<Record<ArpgSkillSlot, number>>;
  buffs: ArpgBuff[];
  action: ArpgCombatAction | null;
  bossPhase?: number;
}

export interface ArpgSkillDef {
  id: string;
  classId: ArpgClassId | "enemy";
  slot: ArpgSkillSlot;
  name: string;
  targeting: ArpgTargeting;
  range: number;
  radius?: number;
  cost: number;
  cooldownMs: number;
  windupMs: number;
  impactMs: number;
  recoveryMs: number;
  damageMultiplier?: number;
  healMultiplier?: number;
  buff?: Omit<ArpgBuff, "id" | "expiresAtMs"> & { durationMs: number };
}

export interface ArpgClassDef {
  id: ArpgClassId;
  name: string;
  resourceKind: ArpgResourceKind;
  maxHp: number;
  maxResource: number;
  baseDamage: number;
  attackRange: number;
  moveSpeed: number;
  resourceRegenPerSec: number;
  skills: Record<ArpgSkillSlot, ArpgSkillDef>;
}

export interface ArpgTargetCandidate extends ArpgVec2 {
  id: string;
  hp: number;
  mode: ArpgActorMode;
}

export type ArpgAutoAttackIntent =
  | { type: "none" }
  | { type: "select"; targetId: string }
  | { type: "chase"; targetId: string; point: ArpgVec2 }
  | { type: "attack"; targetId: string };

export type ArpgCombatEvent =
  | { type: "damage"; sourceId: string; targetId: string; amount: number; skillId: string }
  | { type: "heal"; sourceId: string; targetId: string; amount: number; skillId: string }
  | { type: "buff"; sourceId: string; targetId: string; buff: ArpgBuff; skillId: string }
  | { type: "death"; sourceId: string; targetId: string }
  | { type: "phase"; targetId: string; phase: number };

export const ARPG_WALKABLE_RECTS: ArpgRect[] = [
  { id: "town", minX: 2, maxX: 32, minY: 2, maxY: 10.5 },
  { id: "road", minX: 12, maxX: 22, minY: 9, maxY: 14 },
  { id: "farm", minX: 5, maxX: 29, minY: 12, maxY: 25 },
  { id: "elite", minX: 7, maxX: 27, minY: 23, maxY: 30 },
  { id: "boss", minX: 11, maxX: 23, minY: 28, maxY: 33 },
];

export const ARPG_CLASS_DEFS: Record<ArpgClassId, ArpgClassDef> = {
  bruiser: {
    id: "bruiser",
    name: "Bruiser",
    resourceKind: "rage",
    maxHp: 150,
    maxResource: 100,
    baseDamage: 12,
    attackRange: 1.25,
    moveSpeed: 4.5,
    resourceRegenPerSec: 0,
    skills: {
      basic: skill("bruiser_basic", "bruiser", "basic", "Strike", "target", 1.35, 0, 540, 140, 240, 160, 1),
      q: skill("bruiser_cleave", "bruiser", "q", "Cleave", "target", 1.8, 20, 4200, 180, 280, 220, 1.65, 1.6),
      w: { ...skill("bruiser_guard", "bruiser", "w", "Guard", "self", 0, 10, 9000, 80, 120, 180, 0), buff: { kind: "damageReduction", value: 0.45, durationMs: 4200 } },
      e: skill("bruiser_slam", "bruiser", "e", "Leap Slam", "dash", 5.5, 30, 8000, 180, 340, 260, 2.05, 1.8),
      r: skill("bruiser_execute", "bruiser", "r", "Execute", "target", 1.45, 45, 16000, 260, 430, 340, 2.8),
    },
  },
  mage: {
    id: "mage",
    name: "Mage",
    resourceKind: "mana",
    maxHp: 95,
    maxResource: 120,
    baseDamage: 15,
    attackRange: 5.8,
    moveSpeed: 4.25,
    resourceRegenPerSec: 15,
    skills: {
      basic: skill("mage_arcane_bolt", "mage", "basic", "Arcane Bolt", "target", 6, 0, 700, 180, 320, 160, 1),
      q: skill("mage_fireball", "mage", "q", "Fireball", "target", 6.5, 28, 4800, 260, 450, 260, 1.75, 1.7),
      w: { ...skill("mage_frost_nova", "mage", "w", "Frost Nova", "area", 0, 30, 10000, 160, 300, 260, 0.75, 2.4), buff: { kind: "root", value: 1, durationMs: 1400 } },
      e: skill("mage_blink", "mage", "e", "Blink", "dash", 5.5, 22, 8000, 40, 90, 120, 0),
      r: skill("mage_meteor", "mage", "r", "Meteor", "area", 7, 55, 18000, 620, 900, 420, 3.1, 2.6),
    },
  },
  warden: {
    id: "warden",
    name: "Warden",
    resourceKind: "spirit",
    maxHp: 125,
    maxResource: 100,
    baseDamage: 10,
    attackRange: 3.2,
    moveSpeed: 4.4,
    resourceRegenPerSec: 7,
    skills: {
      basic: skill("warden_spear", "warden", "basic", "Spear Hit", "target", 3.3, 0, 650, 160, 300, 160, 1),
      q: skill("warden_nature_shot", "warden", "q", "Nature Shot", "target", 5.4, 18, 4200, 180, 330, 220, 1.55),
      w: skill("warden_mend", "warden", "w", "Mend", "self", 0, 24, 9000, 120, 260, 220, 0, undefined, 1.8),
      e: { ...skill("warden_vines", "warden", "e", "Vine Snare", "area", 5.5, 28, 10000, 260, 480, 260, 0.8, 2.2), buff: { kind: "root", value: 1, durationMs: 1700 } },
      r: { ...skill("warden_guardian", "warden", "r", "Spirit Guardian", "self", 0, 45, 17000, 180, 360, 300, 0), buff: { kind: "guardian", value: 0.35, durationMs: 6000 } },
    },
  },
};

export const ENEMY_BASIC_SKILL: ArpgSkillDef = skill("enemy_claw", "enemy", "basic", "Claw", "target", 1.45, 0, 1200, 240, 380, 240, 1);

function skill(
  id: string,
  classId: ArpgClassId | "enemy",
  slot: ArpgSkillSlot,
  name: string,
  targeting: ArpgTargeting,
  range: number,
  cost: number,
  cooldownMs: number,
  windupMs: number,
  impactMs: number,
  recoveryMs: number,
  damageMultiplier = 1,
  radius?: number,
  healMultiplier?: number,
): ArpgSkillDef {
  return { id, classId, slot, name, targeting, range, cost, cooldownMs, windupMs, impactMs, recoveryMs, damageMultiplier, radius, healMultiplier };
}

export function createArpgPlayerActor(id: string, classId: ArpgClassId): ArpgActorState {
  const def = ARPG_CLASS_DEFS[classId];
  return {
    id,
    kind: "player",
    classId,
    x: 7,
    y: 7,
    hp: def.maxHp,
    maxHp: def.maxHp,
    resource: classId === "bruiser" ? 0 : def.maxResource,
    maxResource: def.maxResource,
    resourceKind: def.resourceKind,
    baseDamage: def.baseDamage,
    attackRange: def.attackRange,
    moveSpeed: def.moveSpeed,
    mode: "idle",
    targetId: null,
    cooldowns: {},
    buffs: [],
    action: null,
  };
}

export function isArpgWalkable(x: number, y: number, rects = ARPG_WALKABLE_RECTS): boolean {
  return rects.some((rect) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY);
}

export function nearestWalkablePoint(point: ArpgVec2, rects = ARPG_WALKABLE_RECTS): ArpgVec2 {
  if (isArpgWalkable(point.x, point.y, rects)) return point;
  let best = { x: rects[0]!.minX, y: rects[0]!.minY };
  let bestD = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const x = clamp(point.x, rect.minX, rect.maxX);
    const y = clamp(point.y, rect.minY, rect.maxY);
    const d = distSq(point, { x, y });
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

export function moveArpgActorToward(actor: ArpgActorState, target: ArpgVec2, dtSeconds: number, stopDistance = 0.04): { position: ArpgVec2; arrived: boolean } {
  const dx = target.x - actor.x;
  const dy = target.y - actor.y;
  const len = Math.hypot(dx, dy);
  if (len <= stopDistance) return { position: { x: actor.x, y: actor.y }, arrived: true };
  const step = Math.min(len, actor.moveSpeed * dtSeconds);
  return {
    position: nearestWalkablePoint({ x: actor.x + (dx / len) * step, y: actor.y + (dy / len) * step }),
    arrived: len - step <= stopDistance,
  };
}

export function liveArpgTargetsInRange(actor: ArpgVec2, candidates: ArpgTargetCandidate[], range: number): ArpgTargetCandidate[] {
  return candidates
    .filter((candidate) => candidate.hp > 0 && candidate.mode !== "dead" && distance(actor, candidate) <= range)
    .sort((a, b) => distance(actor, a) - distance(actor, b) || a.id.localeCompare(b.id));
}

export function cycleArpgTarget(actor: ArpgVec2, candidates: ArpgTargetCandidate[], currentTargetId: string | null, range: number): ArpgTargetCandidate | null {
  const targets = liveArpgTargetsInRange(actor, candidates, range);
  if (targets.length <= 0) return null;
  const currentIndex = currentTargetId ? targets.findIndex((target) => target.id === currentTargetId) : -1;
  return targets[(currentIndex + 1) % targets.length] ?? targets[0]!;
}

export function resolveArpgAutoAttackIntent(
  actor: ArpgActorState,
  basicSkill: ArpgSkillDef,
  candidates: ArpgActorState[],
  currentTargetId: string | null,
  aggroTargetIds: string[],
  nowMs: number,
): ArpgAutoAttackIntent {
  if (actor.mode === "dead" || actor.hp <= 0 || (actor.action && nowMs < actor.action.endsAtMs)) return { type: "none" };
  const aggroTargets = new Set(aggroTargetIds);
  const valid = candidates.filter((candidate) => candidate.hp > 0 && candidate.mode !== "dead" && aggroTargets.has(candidate.id));
  if (valid.length <= 0) return { type: "none" };
  const current = valid.find((candidate) => candidate.id === currentTargetId);
  const target = current ?? valid.sort((a, b) => distance(actor, a) - distance(actor, b) || a.id.localeCompare(b.id))[0]!;
  if (!current) return { type: "select", targetId: target.id };
  const check = canCastSkill(actor, basicSkill, nowMs, target);
  if (check.ok) return { type: "attack", targetId: target.id };
  if (check.reason === "range") return { type: "chase", targetId: target.id, point: nearestWalkablePoint(target) };
  return { type: "none" };
}

export function canCastSkill(actor: ArpgActorState, skill: ArpgSkillDef, nowMs: number, target?: ArpgActorState, point?: ArpgVec2): { ok: boolean; reason?: string } {
  if (actor.mode === "dead" || actor.hp <= 0) return { ok: false, reason: "dead" };
  if (actor.action && nowMs < actor.action.endsAtMs) return { ok: false, reason: "busy" };
  if ((actor.cooldowns[skill.slot] ?? 0) > nowMs) return { ok: false, reason: "cooldown" };
  if (actor.resource < skill.cost) return { ok: false, reason: "resource" };
  if (skill.targeting === "target") {
    if (!target || target.mode === "dead" || target.hp <= 0) return { ok: false, reason: "target" };
    if (distance(actor, target) > skill.range) return { ok: false, reason: "range" };
  }
  if ((skill.targeting === "area" || skill.targeting === "dash") && point && skill.range > 0 && distance(actor, point) > skill.range) return { ok: false, reason: "range" };
  return { ok: true };
}

export function startSkill(actor: ArpgActorState, skill: ArpgSkillDef, nowMs: number, target?: ArpgActorState, point?: ArpgVec2): void {
  actor.resource = Math.max(0, actor.resource - skill.cost);
  actor.cooldowns[skill.slot] = nowMs + skill.cooldownMs;
  actor.mode = skill.slot === "basic" ? "basic" : "casting";
  actor.action = {
    skillId: skill.id,
    startedAtMs: nowMs,
    impactAtMs: nowMs + skill.impactMs,
    endsAtMs: nowMs + skill.impactMs + skill.recoveryMs,
    targetId: target?.id,
    point,
    impacted: false,
  };
}

export function advanceCombat(actor: ArpgActorState, dtMs: number, nowMs: number): void {
  actor.buffs = actor.buffs.filter((buff) => buff.expiresAtMs > nowMs);
  for (const slot of Object.keys(actor.cooldowns) as ArpgSkillSlot[]) {
    if ((actor.cooldowns[slot] ?? 0) <= nowMs) delete actor.cooldowns[slot];
  }
  if (actor.kind === "player" && actor.classId) {
    const def = ARPG_CLASS_DEFS[actor.classId];
    actor.resource = clamp(actor.resource + (def.resourceRegenPerSec * dtMs) / 1000, 0, actor.maxResource);
  }
  if (actor.action && nowMs >= actor.action.endsAtMs) {
    actor.action = null;
    actor.mode = actor.hp <= 0 ? "dead" : "idle";
  }
}

export function applySkillImpact(
  source: ArpgActorState,
  skill: ArpgSkillDef,
  actors: ArpgActorState[],
  nowMs: number,
  inventory?: ArpgInventoryState,
): ArpgCombatEvent[] {
  if (!source.action || source.action.impacted || nowMs < source.action.impactAtMs) return [];
  source.action.impacted = true;

  const events: ArpgCombatEvent[] = [];
  const targets = impactedTargets(source, skill, actors);
  if (skill.healMultiplier) {
    const amount = Math.round((source.baseDamage + weaponAttack(inventory)) * skill.healMultiplier);
    source.hp = clamp(source.hp + amount, 0, source.maxHp);
    events.push({ type: "heal", sourceId: source.id, targetId: source.id, amount, skillId: skill.id });
  }
  if (skill.buff) {
    const buff: ArpgBuff = { id: `${skill.id}-${nowMs}`, kind: skill.buff.kind, value: skill.buff.value, expiresAtMs: nowMs + skill.buff.durationMs };
    source.buffs.push(buff);
    events.push({ type: "buff", sourceId: source.id, targetId: source.id, buff, skillId: skill.id });
  }
  for (const target of targets) {
    const damage = resolveArpgDamage(source, target, skill, inventory);
    if (damage <= 0) continue;
    target.hp = Math.max(0, target.hp - damage);
    target.mode = target.hp <= 0 ? "dead" : "hit";
    if (source.classId === "bruiser") source.resource = clamp(source.resource + 12, 0, source.maxResource);
    if (source.classId === "warden") source.resource = clamp(source.resource + 9, 0, source.maxResource);
    events.push({ type: "damage", sourceId: source.id, targetId: target.id, amount: damage, skillId: skill.id });
    if (skill.buff && skill.buff.kind !== "damageReduction" && skill.buff.kind !== "guardian") {
      const buff: ArpgBuff = { id: `${skill.id}-${target.id}-${nowMs}`, kind: skill.buff.kind, value: skill.buff.value, expiresAtMs: nowMs + skill.buff.durationMs };
      target.buffs.push(buff);
      events.push({ type: "buff", sourceId: source.id, targetId: target.id, buff, skillId: skill.id });
    }
    if (target.hp <= 0) events.push({ type: "death", sourceId: source.id, targetId: target.id });
    const phase = bossPhaseFor(target);
    if (phase && phase !== target.bossPhase) {
      target.bossPhase = phase;
      events.push({ type: "phase", targetId: target.id, phase });
    }
  }
  return events;
}

export function resolveArpgDamage(source: ArpgActorState, target: ArpgActorState, skill: ArpgSkillDef, inventory?: ArpgInventoryState): number {
  let damage = (source.baseDamage + weaponAttack(inventory)) * (skill.damageMultiplier ?? 1);
  if (skill.id === "bruiser_execute" && target.hp / target.maxHp <= 0.35) damage *= 1.9;
  for (const buff of source.buffs) {
    if (buff.kind === "damageBoost" || buff.kind === "guardian") damage *= 1 + buff.value;
  }
  for (const buff of target.buffs) {
    if (buff.kind === "damageReduction") damage *= 1 - buff.value;
  }
  return Math.max(0, Math.round(damage));
}

function impactedTargets(source: ArpgActorState, skill: ArpgSkillDef, actors: ArpgActorState[]): ArpgActorState[] {
  if (skill.targeting === "self" && !skill.damageMultiplier) return [];
  const center = skill.targeting === "area" ? (source.action?.point ?? source) : source.action?.targetId ? actors.find((actor) => actor.id === source.action?.targetId) : source.action?.point;
  if (!center) return [];
  const radius = skill.radius ?? 0.1;
  if (skill.targeting === "target" && radius <= 0.2) {
    const target = actors.find((actor) => actor.id === source.action?.targetId && actor.hp > 0 && actor.mode !== "dead");
    return target ? [target] : [];
  }
  return actors.filter((actor) => actor.id !== source.id && actor.hp > 0 && actor.mode !== "dead" && distance(actor, center) <= radius);
}

function bossPhaseFor(actor: ArpgActorState): number | undefined {
  if (actor.enemyRank !== "boss" || actor.hp <= 0) return actor.bossPhase;
  const pct = actor.hp / actor.maxHp;
  if (pct <= 0.33) return 3;
  if (pct <= 0.66) return 2;
  return 1;
}

function weaponAttack(inventory?: ArpgInventoryState): number {
  return inventory ? arpgWeaponAttack(inventory) : 0;
}

export function distance(a: ArpgVec2, b: ArpgVec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distSq(a: ArpgVec2, b: ArpgVec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
