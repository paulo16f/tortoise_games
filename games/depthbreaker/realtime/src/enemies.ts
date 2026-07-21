// Server-side enemy controller. Drives an EnemyState through Idle -> Aggro ->
// Combat -> Leash. EnemyDef carries the rank tuning used by wave spawns.

import { ThreatTable, type AttackTiming } from "@depthbreaker/sim";
import { ENEMY_AGGRO_RADIUS, ENEMY_LEASH_DISTANCE, DEPTHBREAKER_DUNGEON, isDungeonWalkable } from "@depthbreaker/protocol";
import type { EnemyState, DungeonMapDefinition } from "@depthbreaker/protocol";

export type EnemyRank = "normal" | "elite" | "boss";

export interface EnemyDef {
  id: string;
  rank: EnemyRank;
  maxHp: number;
  attackDamage: number;
  attackInterval: number;
  attackRange: number;
  moveSpeed: number;
  armor: number;
  xpValue: number;
  currencyValue: number;
  level: number;
  respawnDelay: number;
  /**
   * Wind-up/recovery for this enemy's basic attack. Heavier enemies telegraph
   * with a longer, readable wind-up (bigger tell = dodgeable = a skill moment,
   * since the hit re-checks range at impact). Falls back to the shared default.
   */
  attackTiming?: AttackTiming;
  /**
   * Telegraphed ground-slam special: every `interval`s in combat, wind up for
   * `windup`s (a warning ring shows client-side), then hit every player within
   * `radius` for `damage`. Dodgeable by leaving the ring. Elites/bosses only.
   */
  special?: { interval: number; windup: number; recovery: number; radius: number; damage: number };
  /** Idle enemies drift within a small radius of their spawn so the world reads as alive. */
  wander?: boolean;
  /** Economy v2: kills pay MATERIALS, not gold — each entry rolls independently. */
  drops?: MaterialDrop[];
}

export interface MaterialDrop {
  itemId: string;
  /** 0..1 roll chance per kill. */
  chance: number;
  /** Stack granted on success (default 1). */
  count?: number;
}

export const GRUNT: EnemyDef = {
  id: "grunt",
  rank: "normal",
  maxHp: 50,
  attackDamage: 6,
  attackInterval: 1.2,
  attackRange: 2.2,
  // Move speeds tuned down alongside PLAYER_SPEED (6 -> 4) so enemy locomotion
  // clips read the same way the player's do; player/enemy speed ratio preserved.
  moveSpeed: 2.4,
  armor: 8,
  xpValue: 50,
  // Economy v2: trash pays ~no gold — kills pay materials (see drops).
  currencyValue: 0,
  level: 1,
  respawnDelay: 0,
  // Trash: a snappy, light swing; drifts around its post when idle.
  attackTiming: { windup: 0.28, recovery: 0.34 },
  wander: true,
  drops: [{ itemId: "goblin_hide", chance: 0.4 }],
};

/** Fast, fragile pack hunter — spawns in groups; punishes standing still. */
export const SWARMER: EnemyDef = {
  ...GRUNT,
  id: "swarmer",
  rank: "normal",
  maxHp: 28,
  attackDamage: 5,
  attackInterval: 0.9,
  attackRange: 2.0,
  moveSpeed: 3.6,
  armor: 4,
  xpValue: 40,
  currencyValue: 0,
  level: 2,
  attackTiming: { windup: 0.22, recovery: 0.3 },
  wander: true,
};

export const ELITE_GRUNT: EnemyDef = {
  ...GRUNT,
  id: "elite_grunt",
  rank: "elite",
  maxHp: 130,
  attackDamage: 11,
  attackInterval: 1.05,
  moveSpeed: 2.6,
  armor: 16,
  xpValue: 140,
  currencyValue: 2,
  level: 3,
  // Elite slammer: a heavy readable swing, plus a periodic telegraphed stomp.
  attackTiming: { windup: 0.5, recovery: 0.4 },
  special: { interval: 8, windup: 0.7, recovery: 0.5, radius: 3.2, damage: 22 },
  drops: [{ itemId: "goblin_hide", chance: 0.8 }, { itemId: "warband_totem", chance: 0.15 }],
};

export const BOSS_BRUTE: EnemyDef = {
  ...GRUNT,
  id: "boss_brute",
  rank: "boss",
  maxHp: 520,
  attackDamage: 18,
  attackInterval: 1.35,
  attackRange: 2.8,
  moveSpeed: 1.8,
  armor: 28,
  xpValue: 600,
  currencyValue: 10,
  level: 6,
  // Boss: a slow, telegraphed haymaker + a big, frequent ground-slam AoE — the
  // fight is now about reading and dodging the slam, not just trading blows.
  attackTiming: { windup: 0.75, recovery: 0.5 },
  special: { interval: 6, windup: 0.85, recovery: 0.6, radius: 4.6, damage: 34 },
  drops: [{ itemId: "beast_horn", chance: 0.6 }],
};

// --- Per-area rosters (Milestone 2) ------------------------------------------
// Each of the three town-ringing areas has its own minion / elite / boss, scaled
// by its level band, plus a Coliseum world boss. Ids are themed so distinct
// meshes drop in later (client ENEMY_MODELS) — today they reuse the skeleton /
// undead-knight / boss-skeleton meshes. Stats scale off the base archetypes so
// combat tuning stays in one place.
function scaled(base: EnemyDef, id: string, mult: number, level: number): EnemyDef {
  return {
    ...base,
    id,
    level,
    maxHp: Math.round(base.maxHp * mult),
    attackDamage: Math.round(base.attackDamage * mult),
    xpValue: Math.round(base.xpValue * mult),
    currencyValue: Math.round(base.currencyValue * mult),
    special: base.special ? { ...base.special, damage: Math.round(base.special.damage * mult) } : undefined,
  };
}

function withDrops(def: EnemyDef, drops: MaterialDrop[]): EnemyDef {
  return { ...def, drops };
}

export interface AreaRoster {
  minion: EnemyDef;
  elite: EnemyDef;
  boss: EnemyDef;
}

/** Indexed by area (0 = Area 1 … 2 = Area 3). Bands ≈ Lv 1-10 / 10-20 / 30-40.
 *  Economy v2: each zone family drops its own material pair (common ~60% on
 *  minions, guaranteed + uncommon on elites, uncommon ×2 + rare on bosses) —
 *  materials are the volume economy; gold stays scarce. */
export const AREA_ROSTERS: AreaRoster[] = [
  {
    minion: withDrops(scaled(GRUNT, "goblin", 1.0, 4), [{ itemId: "goblin_hide", chance: 0.6 }, { itemId: "warband_totem", chance: 0.08 }]),
    elite: withDrops(scaled(ELITE_GRUNT, "goblin_warrior", 1.0, 7), [{ itemId: "goblin_hide", chance: 1, count: 2 }, { itemId: "warband_totem", chance: 0.25 }]),
    boss: withDrops(scaled(BOSS_BRUTE, "goblin_warchief", 1.0, 10), [{ itemId: "warband_totem", chance: 1, count: 2 }, { itemId: "beast_horn", chance: 0.4 }]),
  },
  {
    minion: withDrops(scaled(GRUNT, "skeleton_soldier", 2.2, 14), [{ itemId: "bone_shard", chance: 0.6 }, { itemId: "grave_iron", chance: 0.08 }]),
    elite: withDrops(scaled(ELITE_GRUNT, "skeleton_knight", 2.3, 17), [{ itemId: "bone_shard", chance: 1, count: 2 }, { itemId: "grave_iron", chance: 0.25 }]),
    boss: withDrops(scaled(BOSS_BRUTE, "skeleton_lord", 2.6, 20), [{ itemId: "grave_iron", chance: 1, count: 2 }, { itemId: "beast_horn", chance: 0.4 }]),
  },
  {
    minion: withDrops(scaled(GRUNT, "demon_imp", 5.0, 32), [{ itemId: "demon_essence", chance: 0.6 }, { itemId: "infernal_core", chance: 0.08 }]),
    elite: withDrops(scaled(ELITE_GRUNT, "demon_brute", 5.4, 36), [{ itemId: "demon_essence", chance: 1, count: 2 }, { itemId: "infernal_core", chance: 0.25 }]),
    boss: withDrops(scaled(BOSS_BRUTE, "demon_lord", 6.0, 40), [{ itemId: "infernal_core", chance: 1, count: 2 }, { itemId: "beast_horn", chance: 0.4 }]),
  },
];

/** The Coliseum arena's world boss — the toughest single fight on the map. */
export const COLISEUM_BOSS: EnemyDef = withDrops(scaled(BOSS_BRUTE, "coliseum_champion", 3.0, 25), [
  { itemId: "champion_sigil", chance: 1 },
  { itemId: "infernal_core", chance: 0.5 },
]);

/** The Coliseum boss LEVELS UP each time it's slain: tier 0 = base, and each tier
 *  is +60% power/reward and +3 levels. Same id so the client shows the same mesh. */
export function coliseumBossForTier(tier: number): EnemyDef {
  return scaled(COLISEUM_BOSS, "coliseum_champion", 1 + tier * 0.6, COLISEUM_BOSS.level + tier * 3);
}

/** A live combat target the enemy can act on (player or another entity). */
export interface CombatTarget {
  id: string;
  x: number;
  z: number;
  alive: boolean;
}

/** An active damage-over-time on an enemy, keyed by the caster (Necromancer). */
interface EnemyDot {
  tickDamage: number;
  tickInterval: number;
  tickTimer: number;
  timeLeft: number;
  /** The skill that applied it (drives per-skill tick VFX/SFX). */
  skillId: string;
}

/** A DoT tick that came due this frame; the room routes it through damageEnemy. */
export interface DotTick {
  sourceId: string;
  damage: number;
  skillId: string;
}

/** What the enemy wants to do this tick; the room applies the effects. */
export interface EnemyAction {
  attackTargetId: string | null;
  /** True this tick to begin the telegraphed ground-slam special. */
  special?: boolean;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export class EnemyController {
  readonly def: EnemyDef;
  readonly threat = new ThreatTable();
  /** Active damage-over-time curses, keyed by the caster's id (re-cast refreshes). */
  private readonly dots = new Map<string, EnemyDot>();
  private readonly spawnX: number;
  private readonly spawnZ: number;
  private attackCooldown = 0;
  private specialTimer: number;
  private respawnTimer = 0;
  private wanderTarget: { x: number; z: number } | null = null;
  private wanderTimer = 0;
  // Per-controller deterministic RNG seeded from the spawn point — used for idle
  // wander so the world reads as alive without Math.random on shared content.
  private rngState: number;
  // The per-run map, refreshed each update() so movement collision uses the
  // seeded dungeon rather than the module fallback.
  private map: DungeonMapDefinition = DEPTHBREAKER_DUNGEON;

  constructor(
    readonly state: EnemyState,
    def: EnemyDef,
    spawnX: number,
    spawnZ: number,
  ) {
    this.def = def;
    this.spawnX = spawnX;
    this.spawnZ = spawnZ;
    // Stagger the first special so packs don't all slam on the same tick.
    this.specialTimer = def.special ? def.special.interval * 0.6 : 0;
    this.rngState = ((Math.floor(spawnX * 73856093) ^ Math.floor(spawnZ * 19349663)) >>> 0) || 1;
  }

  private nextRand(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  addThreat(playerId: string, amount: number): void {
    this.threat.addDamage(playerId, amount);
  }

  removeThreat(playerId: string): void {
    this.threat.remove(playerId);
  }

  /** Apply/refresh a caster's damage-over-time on this enemy (Necromancer curse). */
  applyDot(sourceId: string, tickDamage: number, tickInterval: number, duration: number, skillId = ""): void {
    if (!this.state.alive) return;
    this.dots.set(sourceId, { tickDamage, tickInterval, tickTimer: tickInterval, timeLeft: duration, skillId });
  }

  /**
   * Advance all active DoTs by `dt`, returning any ticks that came due this
   * frame (the room applies them through damageEnemy so threat/kills/loot fire).
   * Expired DoTs are dropped.
   */
  advanceDots(dt: number): DotTick[] {
    if (this.dots.size === 0 || !this.state.alive) return [];
    const ticks: DotTick[] = [];
    for (const [sourceId, dot] of this.dots) {
      dot.timeLeft -= dt;
      dot.tickTimer -= dt;
      if (dot.tickTimer <= 0) {
        dot.tickTimer += dot.tickInterval;
        ticks.push({ sourceId, damage: dot.tickDamage, skillId: dot.skillId });
      }
      if (dot.timeLeft <= 0) this.dots.delete(sourceId);
    }
    return ticks;
  }

  /**
   * Taunt: adopt this player as the target now and spike their threat so the
   * enemy sticks to them (Knight's aggro control). No-op while leashing home.
   */
  taunt(playerId: string): void {
    if (!this.state.alive || this.state.fsm === "leash") return;
    this.threat.forceTarget(playerId);
    this.state.targetId = playerId;
    if (this.state.fsm === "idle") this.state.fsm = "aggro";
  }

  update(dt: number, targets: Map<string, CombatTarget>, map: DungeonMapDefinition): EnemyAction {
    this.map = map;
    const s = this.state;

    if (!s.alive) {
      if (this.def.respawnDelay <= 0) return { attackTargetId: null };
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return { attackTargetId: null };
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.specialTimer = Math.max(0, this.specialTimer - dt);

    if (dist(s.x, s.z, this.spawnX, this.spawnZ) > ENEMY_LEASH_DISTANCE) {
      this.enterLeash();
    }

    if (s.fsm === "leash") {
      this.moveToward(this.spawnX, this.spawnZ, dt);
      if (dist(s.x, s.z, this.spawnX, this.spawnZ) < 0.5) {
        s.hp = this.def.maxHp;
        s.fsm = "idle";
      }
      return { attackTargetId: null };
    }

    if (s.fsm === "idle") {
      for (const t of targets.values()) {
        if (t.alive && dist(s.x, s.z, t.x, t.z) <= ENEMY_AGGRO_RADIUS) {
          this.threat.addDamage(t.id, 1);
          s.fsm = "aggro";
          break;
        }
      }
      if (s.fsm === "idle") {
        if (this.def.wander) this.updateWander(dt);
        return { attackTargetId: null };
      }
    }

    const targetId = this.threat.selectTarget(s.targetId || null, (id) => {
      const t = targets.get(id);
      return t ? dist(s.x, s.z, t.x, t.z) <= this.def.attackRange : false;
    });
    const target = targetId ? targets.get(targetId) : undefined;

    if (!target || !target.alive) {
      this.enterLeash();
      return { attackTargetId: null };
    }

    s.targetId = target.id;
    const d = dist(s.x, s.z, target.x, target.z);

    // Ground-slam special: fires when a target is inside the (larger) slam
    // radius, even from beyond melee reach, so it reads as a gap-closing threat.
    if (this.def.special && this.specialTimer <= 0 && d <= this.def.special.radius) {
      this.specialTimer = this.def.special.interval;
      // Reserve the basic-attack timer for the slam's full wind-up + recovery so
      // it can't also fire a normal swing mid-slam (a double-hit / cancelled tell).
      this.attackCooldown = Math.max(this.attackCooldown, this.def.special.windup + this.def.special.recovery);
      s.fsm = "combat";
      this.faceToward(target.x, target.z);
      return { attackTargetId: null, special: true };
    }

    if (d > this.def.attackRange) {
      s.fsm = "aggro";
      this.moveToward(target.x, target.z, dt);
      return { attackTargetId: null };
    }

    s.fsm = "combat";
    this.faceToward(target.x, target.z);
    if (this.attackCooldown <= 0) {
      this.attackCooldown = this.def.attackInterval;
      return { attackTargetId: target.id };
    }
    return { attackTargetId: null };
  }

  /** Idle amble within a small radius of the spawn (deterministic wander). */
  private updateWander(dt: number): void {
    this.wanderTimer -= dt;
    if (!this.wanderTarget || this.wanderTimer <= 0) {
      const ang = this.nextRand() * Math.PI * 2;
      const r = this.nextRand() * 3.5;
      this.wanderTarget = { x: this.spawnX + Math.cos(ang) * r, z: this.spawnZ + Math.sin(ang) * r };
      this.wanderTimer = 2 + this.nextRand() * 3;
    }
    if (dist(this.state.x, this.state.z, this.wanderTarget.x, this.wanderTarget.z) > 0.4) {
      this.moveAt(this.wanderTarget.x, this.wanderTarget.z, dt, this.def.moveSpeed * 0.4);
    }
  }

  takeDamage(amount: number): boolean {
    if (!this.state.alive) return false;
    this.state.hp = Math.max(0, this.state.hp - amount);
    if (this.state.hp <= 0) {
      this.state.alive = false;
      this.state.fsm = "idle";
      this.state.targetId = "";
      this.threat.clear();
      this.dots.clear();
      this.respawnTimer = this.def.respawnDelay;
      return true;
    }
    return false;
  }

  private respawn(): void {
    const s = this.state;
    s.x = this.spawnX;
    s.z = this.spawnZ;
    s.hp = this.def.maxHp;
    s.alive = true;
    s.fsm = "idle";
    s.targetId = "";
  }

  private enterLeash(): void {
    this.threat.clear();
    this.dots.clear();
    this.state.targetId = "";
    this.state.fsm = "leash";
  }

  private moveToward(tx: number, tz: number, dt: number): void {
    this.moveAt(tx, tz, dt, this.def.moveSpeed);
  }

  private moveAt(tx: number, tz: number, dt: number, speed: number): void {
    const s = this.state;
    const dx = tx - s.x;
    const dz = tz - s.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) return;
    const step = Math.min(len, speed * dt);
    const nextX = s.x + (dx / len) * step;
    const nextZ = s.z + (dz / len) * step;
    if (isDungeonWalkable(nextX, nextZ, 0.45, this.map)) {
      s.x = nextX;
      s.z = nextZ;
    } else if (isDungeonWalkable(nextX, s.z, 0.45, this.map)) {
      s.x = nextX;
    } else if (isDungeonWalkable(s.x, nextZ, 0.45, this.map)) {
      s.z = nextZ;
    }
    s.yaw = Math.atan2(dx, dz);
  }

  private faceToward(tx: number, tz: number): void {
    this.state.yaw = Math.atan2(tx - this.state.x, tz - this.state.z);
  }
}
