// Authoritative zone room. Server owns movement, combat, waves, boss portal,
// cooldowns, and class skills; clients send input/target/skill requests only.

import { Room, type Client } from "colyseus";
import {
  ZoneState,
  PlayerState,
  EnemyState,
  ClientMessage,
  ServerMessage,
  ClientMessage as CM,
  PLAYER_SPEED,
  TICK_MS,
  type ClassId,
  type InputMessage,
  type SetTargetMessage,
  type UseSkillMessage,
  type CombatEventMessage,
  type WelcomeMessage,
  DEPTHBREAKER_DUNGEON,
  isDungeonWalkable,
  nearestDungeonSpawn,
} from "@depthbreaker/protocol";
import {
  resolveDamage,
  levelForTotalXp,
  maxCurrencyForDepth,
  maxXpForDepth,
  applyHeal,
  POTION_HEAL_FRACTION,
  POTION_COOLDOWN_SECONDS,
} from "@depthbreaker/sim";
import { EnemyController, GRUNT, ELITE_GRUNT, BOSS_BRUTE, type EnemyDef, type CombatTarget } from "./enemies.js";
import { verifyJoinTicket, type JoinTicketClaims } from "./joinTicket.js";
import { BackendReporter } from "./backendReporter.js";
import { loadConfig, type RealtimeConfig } from "./config.js";

const COLLISION_RADIUS = 0.45;
const PLAYER_MAX_HP = 140;
const PLAYER_CRIT_CHANCE = 0.15;
const INITIAL_ENEMY_COUNT = 3;
const MAX_LIVE_ENEMIES = 8;
const WAVE_INTERVAL_SECONDS = 12;
const ELITE_CHANCE = 0.2;
const BOSS_PORTAL_INTERVAL_SECONDS = 75;
const BOSS_PORTAL_COUNTDOWN_SECONDS = 30;
const WARRIOR_SHIELD_DURATION_SECONDS = 3;
const WARRIOR_SHIELD_COOLDOWN_SECONDS = 10;
const WARRIOR_SLASH_COOLDOWN_SECONDS = 7;
const WARRIOR_SLASH_RANGE = 4.4;
const WARRIOR_SLASH_HALF_ANGLE = Math.PI / 3;
const WARRIOR_SLASH_DAMAGE = 28;
const MAGE_FIREBALL_COOLDOWN_SECONDS = 6;
const MAGE_FIREBALL_RADIUS = 3.2;
const MAGE_FIREBALL_DAMAGE = 24;
const MAGE_FROST_DURATION_SECONDS = 6;
const MAGE_FROST_COOLDOWN_SECONDS = 14;
const MAGE_FROST_RADIUS = 3.1;
const MAGE_FROST_TICK_SECONDS = 0.5;
const MAGE_FROST_DAMAGE = 6;

interface ClassProfile {
  attackRaw: number;
  attackInterval: number;
  attackRange: number;
}

function classProfile(classId: ClassId): ClassProfile {
  switch (classId) {
    case "mage":
      return { attackRaw: 14, attackInterval: 1.1, attackRange: 15 };
    case "warden":
      return { attackRaw: 10, attackInterval: 1.0, attackRange: 8 };
    case "bruiser":
    default:
      return { attackRaw: 12, attackInterval: 1.0, attackRange: 2.6 };
  }
}

interface PlayerRuntime {
  input: { moveX: number; moveZ: number; yaw: number };
  attackCooldown: number;
  potionCooldown: number;
  skillQCooldown: number;
  skillECooldown: number;
  shieldSeconds: number;
  frostSeconds: number;
  frostTick: number;
  respawnTimer: number;
  profile: ClassProfile;
  runId: string | null;
  characterId: string;
  earnedXp: number;
  earnedCurrency: number;
  ticketed: boolean;
}

type AuthData = { claims: JoinTicketClaims | null; classId: ClassId; name: string };

export class ZoneRoom extends Room<ZoneState> {
  private config: RealtimeConfig = loadConfig();
  private reporter = new BackendReporter(this.config.backendUrl, this.config.zoneSharedSecret);
  private runtimes = new Map<string, PlayerRuntime>();
  private enemies: EnemyController[] = [];
  private tick = 0;
  private spawnSeq = 0;
  private waveTimer = WAVE_INTERVAL_SECONDS;
  private bossPortalTimer = BOSS_PORTAL_INTERVAL_SECONDS;

  override onCreate(): void {
    this.setState(new ZoneState());
    this.state.zoneId = "hub";

    this.spawnInitialEnemies();

    this.onMessage(ClientMessage.Input, (client, message: InputMessage) => {
      const rt = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!rt || !player || !player.alive) return;
      rt.input.moveX = Math.max(-1, Math.min(1, message.moveX ?? 0));
      rt.input.moveZ = Math.max(-1, Math.min(1, message.moveZ ?? 0));
      rt.input.yaw = message.yaw ?? player.yaw;
    });

    this.onMessage(CM.SetTarget, (client, message: SetTargetMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const id = message.targetId ?? "";
      if (id === "") player.targetId = "";
      else if (this.state.enemies.get(id)?.alive) player.targetId = id;
    });

    this.onMessage(CM.UseSkill, (client, message: UseSkillMessage) => {
      const slot = message?.slot ?? -1;
      if (slot === 1) this.usePotion(client.sessionId);
      else if (slot === 0) this.usePrimarySkill(client.sessionId);
      else if (slot === 2) this.useSecondarySkill(client.sessionId);
    });

    this.setSimulationInterval((dt) => this.update(dt / 1000), TICK_MS);
  }

  override async onAuth(_client: Client, options: unknown): Promise<AuthData> {
    const opts = (options ?? {}) as { ticket?: string; classId?: ClassId; name?: string };
    const classId: ClassId =
      opts.classId === "mage" || opts.classId === "warden" ? opts.classId : "bruiser";
    const name = (opts.name ?? "Adventurer").slice(0, 20);

    if (opts.ticket) {
      const claims = await verifyJoinTicket(opts.ticket, this.config.zoneSharedSecret);
      if (claims) return { claims, classId, name };
      if (this.config.requireTicket) throw new Error("invalid join ticket");
    } else if (this.config.requireTicket) {
      throw new Error("join ticket required");
    }
    return { claims: null, classId, name };
  }

  override onJoin(client: Client, _options: unknown, auth: AuthData): void {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.accountId = auth.claims?.accountId ?? "";
    player.characterId = auth.claims?.characterId ?? "";
    player.name = auth.name;
    player.classId = auth.classId;
    player.maxHp = PLAYER_MAX_HP;
    player.hp = PLAYER_MAX_HP;
    player.level = 1;
    player.alive = true;
    const spawn = this.ringSpawn(this.state.players.size);
    player.x = spawn.x;
    player.z = spawn.z;
    this.state.players.set(client.sessionId, player);

    this.runtimes.set(client.sessionId, {
      input: { moveX: 0, moveZ: 0, yaw: 0 },
      attackCooldown: 0,
      potionCooldown: 0,
      skillQCooldown: 0,
      skillECooldown: 0,
      shieldSeconds: 0,
      frostSeconds: 0,
      frostTick: 0,
      respawnTimer: 0,
      profile: classProfile(auth.classId),
      runId: auth.claims?.runId ?? null,
      characterId: auth.claims?.characterId ?? "",
      earnedXp: 0,
      earnedCurrency: 0,
      ticketed: auth.claims !== null,
    });

    if (auth.claims) this.state.seed = auth.claims.seed;

    const welcome: WelcomeMessage = {
      selfId: client.sessionId,
      runId: auth.claims?.runId ?? "",
      seed: auth.claims?.seed ?? 0,
    };
    client.send(ServerMessage.Welcome, welcome);
  }

  override async onLeave(client: Client, _consented: boolean): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    for (const enemy of this.enemies) enemy.removeThreat(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);

    if (rt?.ticketed && rt.runId) {
      const depth = this.state.depth;
      await this.reporter.reportRunFinish(rt.runId, {
        outcome: "abandoned",
        depthReached: depth,
        xpEarned: Math.min(rt.earnedXp, maxXpForDepth(depth)),
        currencyEarned: Math.min(rt.earnedCurrency, maxCurrencyForDepth(depth)),
        loot: [],
      });
    }
  }

  private update(dt: number): void {
    this.tick++;
    this.movePlayers(dt);
    this.updateCooldowns(dt);
    this.updateWaves(dt);
    this.updateBossPortal(dt);

    const targets = this.buildTargetMap();
    this.updateEnemies(dt, targets);
    this.updateFrostAuras(dt);
    this.updatePlayerAttacks(dt);
    this.updateRespawns(dt);
  }

  private movePlayers(dt: number): void {
    this.runtimes.forEach((rt, id) => {
      const p = this.state.players.get(id);
      if (!p || !p.alive) return;
      const { moveX, moveZ } = rt.input;
      const len = Math.hypot(moveX, moveZ);
      if (len > 1e-3) {
        const nx = moveX / len;
        const nz = moveZ / len;
        const nextX = p.x + nx * PLAYER_SPEED * dt;
        const nextZ = p.z + nz * PLAYER_SPEED * dt;
        if (isDungeonWalkable(nextX, nextZ, COLLISION_RADIUS)) {
          p.x = nextX;
          p.z = nextZ;
        } else if (isDungeonWalkable(nextX, p.z, COLLISION_RADIUS)) {
          p.x = nextX;
        } else if (isDungeonWalkable(p.x, nextZ, COLLISION_RADIUS)) {
          p.z = nextZ;
        }
        p.yaw = Math.atan2(nx, nz);
      }
    });
  }

  private updateCooldowns(dt: number): void {
    this.runtimes.forEach((rt, id) => {
      rt.potionCooldown = Math.max(0, rt.potionCooldown - dt);
      rt.skillQCooldown = Math.max(0, rt.skillQCooldown - dt);
      rt.skillECooldown = Math.max(0, rt.skillECooldown - dt);
      rt.shieldSeconds = Math.max(0, rt.shieldSeconds - dt);
      rt.frostSeconds = Math.max(0, rt.frostSeconds - dt);
      const p = this.state.players.get(id);
      if (!p) return;
      p.potionCooldown = rt.potionCooldown;
      p.skillQCooldown = rt.skillQCooldown;
      p.skillECooldown = rt.skillECooldown;
      p.shieldSeconds = rt.shieldSeconds;
      p.frostSeconds = rt.frostSeconds;
    });
  }

  private updateWaves(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.waveTimer = WAVE_INTERVAL_SECONDS;
    if (this.liveEnemyCount() >= MAX_LIVE_ENEMIES) return;
    const elite = Math.random() < ELITE_CHANCE;
    const point = this.randomSpawnPoint();
    this.spawnEnemy(elite ? ELITE_GRUNT : GRUNT, point.x, point.z);
  }

  private updateBossPortal(dt: number): void {
    const portal = this.state.bossPortal;
    const bossAlive = this.enemies.some((e) => e.def.rank === "boss" && e.state.alive);
    if (portal.active) {
      portal.countdown = Math.max(0, portal.countdown - dt);
      if (portal.countdown <= 0) {
        this.spawnEnemy(BOSS_BRUTE, portal.x, portal.z);
        portal.active = false;
        portal.countdown = 0;
        this.bossPortalTimer = BOSS_PORTAL_INTERVAL_SECONDS;
      }
      return;
    }
    if (bossAlive) return;
    this.bossPortalTimer -= dt;
    if (this.bossPortalTimer <= 0) {
      const point = DEPTHBREAKER_DUNGEON.bossPortal;
      portal.active = true;
      portal.x = point.x;
      portal.z = point.z;
      portal.countdown = BOSS_PORTAL_COUNTDOWN_SECONDS;
    }
  }

  private buildTargetMap(): Map<string, CombatTarget> {
    const targets = new Map<string, CombatTarget>();
    this.state.players.forEach((p) => targets.set(p.id, { id: p.id, x: p.x, z: p.z, alive: p.alive }));
    return targets;
  }

  private updateEnemies(dt: number, targets: Map<string, CombatTarget>): void {
    for (const enemy of this.enemies) {
      const action = enemy.update(dt, targets);
      if (action.attackTargetId) this.enemyHitsPlayer(enemy, action.attackTargetId);
    }
  }

  private updateFrostAuras(dt: number): void {
    this.runtimes.forEach((rt, id) => {
      if (rt.frostSeconds <= 0) return;
      rt.frostTick -= dt;
      if (rt.frostTick > 0) return;
      rt.frostTick = MAGE_FROST_TICK_SECONDS;
      const p = this.state.players.get(id);
      if (!p || !p.alive) return;
      for (const enemy of this.enemies) {
        if (!enemy.state.alive) continue;
        const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
        if (d > MAGE_FROST_RADIUS) continue;
        this.damageEnemy(id, rt, p, enemy, MAGE_FROST_DAMAGE, "skill");
      }
    });
  }

  private updatePlayerAttacks(dt: number): void {
    this.runtimes.forEach((rt, id) => {
      const p = this.state.players.get(id);
      if (!p || !p.alive) return;
      rt.attackCooldown = Math.max(0, rt.attackCooldown - dt);
      if (!p.targetId || rt.attackCooldown > 0) return;

      const enemy = this.enemies.find((e) => e.state.id === p.targetId);
      if (!enemy || !enemy.state.alive) {
        p.targetId = "";
        return;
      }
      const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
      if (d > rt.profile.attackRange) return;

      this.facePlayerToEnemy(p, enemy);
      rt.attackCooldown = rt.profile.attackInterval;
      const isCrit = Math.random() < PLAYER_CRIT_CHANCE;
      const dmg = resolveDamage(rt.profile.attackRaw, enemy.def.armor, p.level, isCrit);
      this.damageEnemy(id, rt, p, enemy, dmg, isCrit ? "crit" : "hit");
    });
  }

  private usePotion(playerId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    if (rt.potionCooldown > 0 || p.hp >= p.maxHp) return;
    const { newHp, effective } = applyHeal(p.hp, p.maxHp, POTION_HEAL_FRACTION);
    p.hp = newHp;
    rt.potionCooldown = POTION_COOLDOWN_SECONDS;
    p.potionCooldown = POTION_COOLDOWN_SECONDS;
    this.applyHealThreat(playerId, effective);
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: -effective, kind: "heal" });
  }

  private usePrimarySkill(playerId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive || rt.skillQCooldown > 0) return;
    if (p.classId === "mage") this.castMageFireball(playerId, rt, p);
    else this.castWarriorShield(rt, p);
  }

  private useSecondarySkill(playerId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive || rt.skillECooldown > 0) return;
    if (p.classId === "mage") this.castMageFrost(rt, p);
    else this.castWarriorSlash(playerId, rt, p);
  }

  private castWarriorShield(rt: PlayerRuntime, p: PlayerState): void {
    rt.skillQCooldown = WARRIOR_SHIELD_COOLDOWN_SECONDS;
    rt.shieldSeconds = WARRIOR_SHIELD_DURATION_SECONDS;
    p.skillQCooldown = rt.skillQCooldown;
    p.shieldSeconds = rt.shieldSeconds;
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill" });
  }

  private castWarriorSlash(playerId: string, rt: PlayerRuntime, p: PlayerState): void {
    rt.skillECooldown = WARRIOR_SLASH_COOLDOWN_SECONDS;
    p.skillECooldown = rt.skillECooldown;
    let hit = false;
    for (const enemy of this.enemies) {
      if (!enemy.state.alive) continue;
      const dx = enemy.state.x - p.x;
      const dz = enemy.state.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > WARRIOR_SLASH_RANGE || d < 1e-3) continue;
      const angle = Math.atan2(dx, dz);
      if (Math.abs(angleDiff(p.yaw, angle)) > WARRIOR_SLASH_HALF_ANGLE) continue;
      hit = true;
      this.damageEnemy(playerId, rt, p, enemy, WARRIOR_SLASH_DAMAGE, "skill");
    }
    if (!hit) this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill" });
  }

  private castMageFireball(playerId: string, rt: PlayerRuntime, p: PlayerState): void {
    const primary = p.targetId ? this.enemies.find((e) => e.state.id === p.targetId && e.state.alive) : null;
    if (!primary) return;
    rt.skillQCooldown = MAGE_FIREBALL_COOLDOWN_SECONDS;
    p.skillQCooldown = rt.skillQCooldown;
    this.facePlayerToEnemy(p, primary);
    for (const enemy of this.enemies) {
      if (!enemy.state.alive) continue;
      const d = Math.hypot(enemy.state.x - primary.state.x, enemy.state.z - primary.state.z);
      if (d <= MAGE_FIREBALL_RADIUS) this.damageEnemy(playerId, rt, p, enemy, MAGE_FIREBALL_DAMAGE, "skill");
    }
  }

  private castMageFrost(rt: PlayerRuntime, p: PlayerState): void {
    rt.skillECooldown = MAGE_FROST_COOLDOWN_SECONDS;
    rt.frostSeconds = MAGE_FROST_DURATION_SECONDS;
    rt.frostTick = 0;
    p.skillECooldown = rt.skillECooldown;
    p.frostSeconds = rt.frostSeconds;
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill" });
  }

  private enemyHitsPlayer(enemy: EnemyController, playerId: string): void {
    const p = this.state.players.get(playerId);
    const rt = this.runtimes.get(playerId);
    if (!p || !rt || !p.alive) return;
    if (rt.shieldSeconds > 0) {
      this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: 0, kind: "skill" });
      return;
    }
    const playerArmor = p.level * 5;
    const dmg = resolveDamage(enemy.def.attackDamage, playerArmor, enemy.def.level, false);
    p.hp = Math.max(0, p.hp - dmg);
    this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: dmg, kind: "hit" });
    if (p.hp <= 0) {
      p.alive = false;
      p.targetId = "";
      rt.respawnTimer = 4;
      for (const e of this.enemies) e.removeThreat(playerId);
      this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: 0, kind: "death" });
    }
  }

  private damageEnemy(
    playerId: string,
    rt: PlayerRuntime,
    p: PlayerState,
    enemy: EnemyController,
    amount: number,
    kind: CombatEventMessage["kind"],
  ): void {
    enemy.addThreat(playerId, Math.max(1, amount));
    const killed = enemy.takeDamage(amount);
    this.emitCombat({ sourceId: playerId, targetId: enemy.state.id, amount, kind });
    if (killed) {
      this.emitCombat({ sourceId: playerId, targetId: enemy.state.id, amount: 0, kind: "death" });
      this.awardKill(rt, p, enemy.def.xpValue, enemy.def.currencyValue);
      if (p.targetId === enemy.state.id) p.targetId = "";
    }
  }

  private applyHealThreat(playerId: string, effective: number): void {
    if (effective <= 0) return;
    const engaged = this.enemies.filter((e) => e.state.alive && e.threat.getThreat(playerId) > 0);
    if (engaged.length === 0) return;
    const share = effective / engaged.length;
    for (const enemy of engaged) enemy.threat.addHeal(playerId, share);
  }

  private awardKill(rt: PlayerRuntime, p: PlayerState, xp: number, currency: number): void {
    rt.earnedXp += xp;
    rt.earnedCurrency += currency;
    p.runXp += xp;
    p.level = levelForTotalXp(p.runXp);
  }

  private updateRespawns(dt: number): void {
    this.runtimes.forEach((rt, id) => {
      const p = this.state.players.get(id);
      if (!p || p.alive) return;
      rt.respawnTimer -= dt;
      if (rt.respawnTimer <= 0) {
        const spawn = this.ringSpawn(0);
        p.x = spawn.x;
        p.z = spawn.z;
        p.hp = p.maxHp;
        p.alive = true;
      }
    });
  }

  private emitCombat(event: CombatEventMessage): void {
    this.broadcast(ServerMessage.CombatEvent, event);
  }

  private spawnInitialEnemies(): void {
    const points = DEPTHBREAKER_DUNGEON.enemySpawns;
    points.slice(0, INITIAL_ENEMY_COUNT).forEach((pt) => this.spawnEnemy(GRUNT, pt.x, pt.z));
  }

  private spawnEnemy(def: EnemyDef, x: number, z: number): EnemyController {
    const state = new EnemyState();
    state.id = `${def.id}-${this.spawnSeq++}`;
    state.defId = def.id;
    state.rank = def.rank;
    state.maxHp = def.maxHp;
    state.hp = def.maxHp;
    state.x = x;
    state.z = z;
    state.fsm = "idle";
    state.alive = true;
    this.state.enemies.set(state.id, state);
    const controller = new EnemyController(state, def, x, z);
    this.enemies.push(controller);
    return controller;
  }

  private liveEnemyCount(): number {
    return this.enemies.reduce((n, e) => n + (e.state.alive && e.def.rank !== "boss" ? 1 : 0), 0);
  }

  private randomSpawnPoint(): { x: number; z: number } {
    return nearestDungeonSpawn(Math.floor(Math.random() * DEPTHBREAKER_DUNGEON.waveSpawns.length));
  }

  private ringSpawn(index: number): { x: number; z: number } {
    if (index === 0) return DEPTHBREAKER_DUNGEON.playerSpawn;
    const angle = (index * Math.PI * 2) / 6;
    return {
      x: DEPTHBREAKER_DUNGEON.playerSpawn.x + Math.cos(angle) * 2,
      z: DEPTHBREAKER_DUNGEON.playerSpawn.z + Math.sin(angle) * 2,
    };
  }

  private facePlayerToEnemy(p: PlayerState, enemy: EnemyController): void {
    const dx = enemy.state.x - p.x;
    const dz = enemy.state.z - p.z;
    if (Math.hypot(dx, dz) > 1e-3) p.yaw = Math.atan2(dx, dz);
  }
}

function angleDiff(a: number, b: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
