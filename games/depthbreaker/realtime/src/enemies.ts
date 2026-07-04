// Server-side enemy controller. Drives an EnemyState through Idle -> Aggro ->
// Combat -> Leash. EnemyDef carries the rank tuning used by wave spawns.

import { ThreatTable } from "@depthbreaker/sim";
import { ENEMY_AGGRO_RADIUS, ENEMY_LEASH_DISTANCE, isDungeonWalkable } from "@depthbreaker/protocol";
import type { EnemyState } from "@depthbreaker/protocol";

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
}

export const GRUNT: EnemyDef = {
  id: "grunt",
  rank: "normal",
  maxHp: 50,
  attackDamage: 6,
  attackInterval: 1.2,
  attackRange: 2.2,
  moveSpeed: 3.5,
  armor: 8,
  xpValue: 50,
  currencyValue: 5,
  level: 1,
  respawnDelay: 0,
};

export const ELITE_GRUNT: EnemyDef = {
  ...GRUNT,
  id: "elite_grunt",
  rank: "elite",
  maxHp: 130,
  attackDamage: 11,
  attackInterval: 1.05,
  moveSpeed: 3.8,
  armor: 16,
  xpValue: 140,
  currencyValue: 18,
  level: 3,
};

export const BOSS_BRUTE: EnemyDef = {
  ...GRUNT,
  id: "boss_brute",
  rank: "boss",
  maxHp: 520,
  attackDamage: 18,
  attackInterval: 1.35,
  attackRange: 2.8,
  moveSpeed: 2.6,
  armor: 28,
  xpValue: 600,
  currencyValue: 80,
  level: 6,
};

/** A live combat target the enemy can act on (player or another entity). */
export interface CombatTarget {
  id: string;
  x: number;
  z: number;
  alive: boolean;
}

/** What the enemy wants to do this tick; the room applies the effects. */
export interface EnemyAction {
  attackTargetId: string | null;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export class EnemyController {
  readonly def: EnemyDef;
  readonly threat = new ThreatTable();
  private readonly spawnX: number;
  private readonly spawnZ: number;
  private attackCooldown = 0;
  private respawnTimer = 0;

  constructor(
    readonly state: EnemyState,
    def: EnemyDef,
    spawnX: number,
    spawnZ: number,
  ) {
    this.def = def;
    this.spawnX = spawnX;
    this.spawnZ = spawnZ;
  }

  addThreat(playerId: string, amount: number): void {
    this.threat.addDamage(playerId, amount);
  }

  removeThreat(playerId: string): void {
    this.threat.remove(playerId);
  }

  update(dt: number, targets: Map<string, CombatTarget>): EnemyAction {
    const s = this.state;

    if (!s.alive) {
      if (this.def.respawnDelay <= 0) return { attackTargetId: null };
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return { attackTargetId: null };
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

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
      if (s.fsm === "idle") return { attackTargetId: null };
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

  takeDamage(amount: number): boolean {
    if (!this.state.alive) return false;
    this.state.hp = Math.max(0, this.state.hp - amount);
    if (this.state.hp <= 0) {
      this.state.alive = false;
      this.state.fsm = "idle";
      this.state.targetId = "";
      this.threat.clear();
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
    this.state.targetId = "";
    this.state.fsm = "leash";
  }

  private moveToward(tx: number, tz: number, dt: number): void {
    const s = this.state;
    const dx = tx - s.x;
    const dz = tz - s.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) return;
    const step = Math.min(len, this.def.moveSpeed * dt);
    const nextX = s.x + (dx / len) * step;
    const nextZ = s.z + (dz / len) * step;
    if (isDungeonWalkable(nextX, nextZ, 0.45)) {
      s.x = nextX;
      s.z = nextZ;
    } else if (isDungeonWalkable(nextX, s.z, 0.45)) {
      s.x = nextX;
    } else if (isDungeonWalkable(s.x, nextZ, 0.45)) {
      s.z = nextZ;
    }
    s.yaw = Math.atan2(dx, dz);
  }

  private faceToward(tx: number, tz: number): void {
    this.state.yaw = Math.atan2(tx - this.state.x, tz - this.state.z);
  }
}
