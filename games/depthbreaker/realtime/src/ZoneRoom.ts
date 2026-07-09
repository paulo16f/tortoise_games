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
  type SetAutoAttackMessage,
  type SetTargetMessage,
  type ToggleWeaponMessage,
  type UseSkillMessage,
  type CombatActionState,
  type CombatEventMessage,
  type WelcomeMessage,
  DEPTHBREAKER_DUNGEON,
  buildDungeon,
  isDungeonWalkable,
  type DungeonMapDefinition,
} from "@depthbreaker/protocol";
import {
  resolveDamage,
  levelForTotalXp,
  maxCurrencyForDepth,
  maxXpForDepth,
  applyHeal,
  POTION_HEAL_FRACTION,
  POTION_COOLDOWN_SECONDS,
  DEFAULT_ENEMY_ATTACK_TIMING,
  DEFAULT_MELEE_ATTACK_TIMING,
  DEFAULT_SKILL_TIMING,
  ENEMY_DYING_SECONDS,
  PROJECTILE_SPEED_UNITS_PER_SECOND,
  advancePendingProjectiles,
  actionDuration,
  createPendingProjectile,
  isCombatActionCurrent,
  projectileTiming,
  type PendingProjectile,
  type ProjectileEntity,
} from "@depthbreaker/sim";
import { EnemyController, GRUNT, ELITE_GRUNT, BOSS_BRUTE, type EnemyDef, type CombatTarget } from "./enemies.js";
import { verifyJoinTicket, type JoinTicketClaims } from "./joinTicket.js";
import { BackendReporter } from "./backendReporter.js";
import { loadConfig, type RealtimeConfig } from "./config.js";

const COLLISION_RADIUS = 0.45;
const PLAYER_MAX_HP = 140;
const PLAYER_CRIT_CHANCE = 0.15;
const INITIAL_ENEMY_COUNT = 3;
const INITIAL_ELITE_COUNT = 2;
const MAX_LIVE_ENEMIES = 8;
const DEAD_ENEMY_DESPAWN_SECONDS = ENEMY_DYING_SECONDS;
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
const TARGET_SELECTION_RANGE = 18;

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

function defaultWeaponForClass(classId: ClassId): string {
  return classId === "mage" ? "ash_staff" : "iron_sword";
}

function basicAttackRaw(p: PlayerState, rt: PlayerRuntime): number {
  return p.weaponId ? rt.profile.attackRaw : Math.max(1, Math.round(rt.profile.attackRaw * 0.45));
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

interface PendingImpact {
  actionId: string;
  timeLeft: number;
  resolve: () => void;
}

type ProjectileResolver = () => void;
type ActionEntity = PlayerState | EnemyState;
type AuthData = { claims: JoinTicketClaims | null; classId: ClassId; name: string };

export class ZoneRoom extends Room<ZoneState> {
  private config: RealtimeConfig = loadConfig();
  private reporter = new BackendReporter(this.config.backendUrl, this.config.zoneSharedSecret);
  private runtimes = new Map<string, PlayerRuntime>();
  // Per-run map, built once from the synced run seed (see ensureSeeded). Starts
  // as the module fallback so anything that reads it before the first join is
  // still valid; the client rebuilds the identical map from the same seed.
  private dungeon: DungeonMapDefinition = DEPTHBREAKER_DUNGEON;
  private initialSpawnsDone = false;
  private enemies: EnemyController[] = [];
  private deadEnemyDespawn = new Map<string, number>();
  private pendingImpacts: PendingImpact[] = [];
  private pendingProjectiles: PendingProjectile<ProjectileResolver>[] = [];
  private tick = 0;
  private elapsedSeconds = 0;
  private spawnSeq = 0;
  private actionSeq = 0;
  private waveTimer = WAVE_INTERVAL_SECONDS;
  private bossPortalTimer = BOSS_PORTAL_INTERVAL_SECONDS;

  override onCreate(): void {
    this.setState(new ZoneState());
    this.state.zoneId = "hub";

    // Initial enemies are spawned in ensureSeeded() once the run seed is known
    // (first join), so they land in the seeded dungeon's rooms - not before.

    this.onMessage(ClientMessage.Input, (client, message: InputMessage) => {
      const rt = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!rt || !player || !player.alive) return;
      rt.input.moveX = Math.max(-1, Math.min(1, message.moveX ?? 0));
      rt.input.moveZ = Math.max(-1, Math.min(1, message.moveZ ?? 0));
      rt.input.yaw = message.yaw ?? player.yaw;
      if (Math.hypot(rt.input.moveX, rt.input.moveZ) > 0.01) player.autoAttack = false;
    });

    this.onMessage(CM.SetTarget, (client, message: SetTargetMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const id = message.targetId ?? "";
      if (id === "") {
        player.targetId = "";
        player.autoAttack = false;
      }
      else {
        const enemy = this.enemies.find((e) => e.state.id === id);
        if (enemy && this.isEnemySelectable(player, enemy)) {
          player.targetId = id;
          player.autoAttack = message.autoAttack ?? player.autoAttack;
        }
      }
    });

    this.onMessage(CM.SetAutoAttack, (client, message: SetAutoAttackMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive || !player.targetId) return;
      player.autoAttack = !!message.enabled;
    });

    this.onMessage(CM.UseSkill, (client, message: UseSkillMessage) => {
      const slot = message?.slot ?? -1;
      if (slot === 1) this.usePotion(client.sessionId);
      else if (slot === 0) this.usePrimarySkill(client.sessionId);
      else if (slot === 2) this.useSecondarySkill(client.sessionId);
    });

    this.onMessage(CM.ToggleWeapon, (client, message: ToggleWeaponMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      player.weaponId = message.equipped ? defaultWeaponForClass(player.classId as ClassId) : "";
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
    // Lock in the run seed and build the map before anything reads a spawn
    // point (ringSpawn below depends on the seeded playerSpawn).
    if (auth.claims) this.state.seed = auth.claims.seed;
    this.ensureSeeded();

    const player = new PlayerState();
    player.id = client.sessionId;
    player.accountId = auth.claims?.accountId ?? "";
    player.characterId = auth.claims?.characterId ?? "";
    player.name = auth.name;
    player.classId = auth.classId;
    player.weaponId = defaultWeaponForClass(auth.classId);
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

    const welcome: WelcomeMessage = {
      selfId: client.sessionId,
      runId: auth.claims?.runId ?? "",
      seed: auth.claims?.seed ?? 0,
    };
    client.send(ServerMessage.Welcome, welcome);
  }

  /** Build the per-run dungeon from the synced seed and spawn its initial
   * occupants, exactly once. Safe to call on every join. */
  private ensureSeeded(): void {
    if (this.initialSpawnsDone) return;
    this.dungeon = buildDungeon(this.state.seed, this.state.depth);
    this.spawnInitialEnemies();
    this.spawnInitialElites();
    this.spawnInitialBoss();
    this.initialSpawnsDone = true;
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
    this.elapsedSeconds += dt;
    this.movePlayers(dt);
    this.updateCooldowns(dt);
    this.updateWaves(dt);
    this.updateBossPortal(dt);

    const targets = this.buildTargetMap();
    this.updateEnemies(dt, targets);
    this.updateFrostAuras(dt);
    this.updatePlayerAttacks(dt);
    this.updatePendingImpacts(dt);
    this.updatePendingProjectiles(dt);
    this.updateActionStates();
    this.updateRespawns(dt);
    this.updateDeadEnemyDespawn(dt);
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
        if (isDungeonWalkable(nextX, nextZ, COLLISION_RADIUS, this.dungeon)) {
          p.x = nextX;
          p.z = nextZ;
        } else if (isDungeonWalkable(nextX, p.z, COLLISION_RADIUS, this.dungeon)) {
          p.x = nextX;
        } else if (isDungeonWalkable(p.x, nextZ, COLLISION_RADIUS, this.dungeon)) {
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
    const def = elite ? ELITE_GRUNT : GRUNT;
    const point = this.randomSpawnPoint(def);
    this.spawnEnemy(def, point.x, point.z);
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
      const point = this.dungeon.bossPortal;
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
      const action = enemy.update(dt, targets, this.dungeon);
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
      if (!p.autoAttack || !p.targetId || rt.attackCooldown > 0) return;

      const enemy = this.enemies.find((e) => e.state.id === p.targetId);
      if (!enemy || !enemy.state.alive) {
        p.targetId = "";
        p.autoAttack = false;
        return;
      }
      const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
      if (d > rt.profile.attackRange) {
        this.autoFollowTarget(p, enemy, dt, rt.profile.attackRange);
        return;
      }

      this.facePlayerToEnemy(p, enemy);
      rt.attackCooldown = rt.profile.attackInterval;
      const actionId = this.nextActionId();
      this.setAction(p, "attack", actionDuration(DEFAULT_MELEE_ATTACK_TIMING), enemy.state.id, actionId);

      if (p.classId === "mage") {
        this.scheduleImpact(actionId, DEFAULT_MELEE_ATTACK_TIMING.windup, () => {
          const source = this.state.players.get(id);
          const target = this.enemies.find((e) => e.state.id === enemy.state.id);
          const liveRt = this.runtimes.get(id);
          if (!source || !liveRt || !source.alive || !target?.state.alive || !this.isCurrentAction(source, actionId)) return;
          this.launchProjectile(actionId, source, target.state, () => {
            const liveSource = this.state.players.get(id);
            const liveTarget = this.enemies.find((e) => e.state.id === enemy.state.id);
            const rtNow = this.runtimes.get(id);
            if (!liveSource || !rtNow || !liveSource.alive || !liveTarget?.state.alive) return;
            const isCrit = Math.random() < PLAYER_CRIT_CHANCE;
            const dmg = resolveDamage(basicAttackRaw(liveSource, rtNow), liveTarget.def.armor, liveSource.level, isCrit);
            this.damageEnemy(id, rtNow, liveSource, liveTarget, dmg, isCrit ? "crit" : "hit", actionId);
          });
        });
      } else {
        this.scheduleImpact(actionId, DEFAULT_MELEE_ATTACK_TIMING.windup, () => {
          const source = this.state.players.get(id);
          const target = this.enemies.find((e) => e.state.id === enemy.state.id);
          const liveRt = this.runtimes.get(id);
          if (!source || !liveRt || !source.alive || !target?.state.alive || !this.isCurrentAction(source, actionId)) return;
          const liveDistance = Math.hypot(target.state.x - source.x, target.state.z - source.z);
          if (liveDistance > liveRt.profile.attackRange + 0.75) return;
          this.facePlayerToEnemy(source, target);
          const isCrit = Math.random() < PLAYER_CRIT_CHANCE;
          const dmg = resolveDamage(basicAttackRaw(source, liveRt), target.def.armor, source.level, isCrit);
          this.damageEnemy(id, liveRt, source, target, dmg, isCrit ? "crit" : "hit", actionId);
        });
      }
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
    this.setAction(p, "skill", 0.35, p.id, this.nextActionId());
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: -effective, kind: "heal", actionId: p.actionId });
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
    const actionId = this.nextActionId();
    this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId });
  }

  private castWarriorSlash(playerId: string, rt: PlayerRuntime, p: PlayerState): void {
    rt.skillECooldown = WARRIOR_SLASH_COOLDOWN_SECONDS;
    p.skillECooldown = rt.skillECooldown;
    const actionId = this.nextActionId();
    this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.targetId, actionId);
    this.scheduleImpact(actionId, DEFAULT_SKILL_TIMING.windup, () => {
      const source = this.state.players.get(playerId);
      const liveRt = this.runtimes.get(playerId);
      if (!source || !liveRt || !source.alive || !this.isCurrentAction(source, actionId)) return;
      let hit = false;
      for (const enemy of this.enemies) {
        if (!enemy.state.alive) continue;
        const dx = enemy.state.x - source.x;
        const dz = enemy.state.z - source.z;
        const d = Math.hypot(dx, dz);
        if (d > WARRIOR_SLASH_RANGE || d < 1e-3) continue;
        const angle = Math.atan2(dx, dz);
        if (Math.abs(angleDiff(source.yaw, angle)) > WARRIOR_SLASH_HALF_ANGLE) continue;
        hit = true;
        this.damageEnemy(playerId, liveRt, source, enemy, WARRIOR_SLASH_DAMAGE, "skill", actionId);
      }
      if (!hit) this.emitCombat({ sourceId: source.id, targetId: source.id, amount: 0, kind: "skill", actionId });
    });
  }

  private castMageFireball(playerId: string, rt: PlayerRuntime, p: PlayerState): void {
    const primary = p.targetId ? this.enemies.find((e) => e.state.id === p.targetId && e.state.alive) : null;
    if (!primary) return;
    rt.skillQCooldown = MAGE_FIREBALL_COOLDOWN_SECONDS;
    p.skillQCooldown = rt.skillQCooldown;
    this.facePlayerToEnemy(p, primary);
    const actionId = this.nextActionId();
    this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), primary.state.id, actionId);
    this.scheduleImpact(actionId, DEFAULT_SKILL_TIMING.windup, () => {
      const source = this.state.players.get(playerId);
      const liveRt = this.runtimes.get(playerId);
      const livePrimary = this.enemies.find((e) => e.state.id === primary.state.id);
      if (!source || !liveRt || !source.alive || !livePrimary?.state.alive || !this.isCurrentAction(source, actionId)) return;
      this.launchProjectile(actionId, source, livePrimary.state, () => {
        const liveSource = this.state.players.get(playerId);
        const rtNow = this.runtimes.get(playerId);
        const impactCenter = this.enemies.find((e) => e.state.id === primary.state.id);
        if (!liveSource || !rtNow || !liveSource.alive || !impactCenter?.state.alive) return;
        for (const enemy of this.enemies) {
          if (!enemy.state.alive) continue;
          const d = Math.hypot(enemy.state.x - impactCenter.state.x, enemy.state.z - impactCenter.state.z);
          if (d <= MAGE_FIREBALL_RADIUS) this.damageEnemy(playerId, rtNow, liveSource, enemy, MAGE_FIREBALL_DAMAGE, "skill", actionId);
        }
      });
    });
  }

  private castMageFrost(rt: PlayerRuntime, p: PlayerState): void {
    rt.skillECooldown = MAGE_FROST_COOLDOWN_SECONDS;
    rt.frostSeconds = MAGE_FROST_DURATION_SECONDS;
    rt.frostTick = 0;
    p.skillECooldown = rt.skillECooldown;
    p.frostSeconds = rt.frostSeconds;
    const actionId = this.nextActionId();
    this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId });
  }

  private enemyHitsPlayer(enemy: EnemyController, playerId: string): void {
    const actionId = this.nextActionId();
    this.setAction(enemy.state, "attack", actionDuration(DEFAULT_ENEMY_ATTACK_TIMING), playerId, actionId);
    this.scheduleImpact(actionId, DEFAULT_ENEMY_ATTACK_TIMING.windup, () => this.resolveEnemyHit(enemy, playerId, actionId));
  }

  private resolveEnemyHit(enemy: EnemyController, playerId: string, actionId: string): void {
    const p = this.state.players.get(playerId);
    const rt = this.runtimes.get(playerId);
    if (!enemy.state.alive || !p || !rt || !p.alive || !this.isCurrentAction(enemy.state, actionId)) return;
    const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
    if (d > enemy.def.attackRange + 0.65) return;
    if (rt.shieldSeconds > 0) {
      this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: 0, kind: "skill", actionId });
      return;
    }
    const playerArmor = p.level * 5;
    const dmg = resolveDamage(enemy.def.attackDamage, playerArmor, enemy.def.level, false);
    p.hp = Math.max(0, p.hp - dmg);
    this.setAction(p, "hit", 0.3, enemy.state.id, actionId);
    this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: dmg, kind: "hit", actionId });
    if (p.hp <= 0) {
      p.alive = false;
      p.targetId = "";
      p.autoAttack = false;
      rt.respawnTimer = 4;
      this.setAction(p, "dead", rt.respawnTimer, enemy.state.id, actionId);
      for (const e of this.enemies) e.removeThreat(playerId);
      this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: 0, kind: "death", actionId });
    }
  }

  private damageEnemy(
    playerId: string,
    rt: PlayerRuntime,
    p: PlayerState,
    enemy: EnemyController,
    amount: number,
    kind: CombatEventMessage["kind"],
    actionId = this.nextActionId(),
  ): void {
    enemy.addThreat(playerId, Math.max(1, amount));
    const killed = enemy.takeDamage(amount);
    if (!killed) this.setAction(enemy.state, "hit", 0.28, playerId, actionId);
    this.emitCombat({ sourceId: playerId, targetId: enemy.state.id, amount, kind, actionId });
    if (killed) {
      this.setAction(enemy.state, "dying", ENEMY_DYING_SECONDS, playerId, actionId);
      this.emitCombat({ sourceId: playerId, targetId: enemy.state.id, amount: 0, kind: "death", actionId });
      this.awardKill(rt, p, enemy.def.xpValue, enemy.def.currencyValue);
      this.retargetPlayersFromDeadEnemy(enemy.state.id);
      this.scheduleEnemyRemoval(enemy);
    }
  }

  private retargetPlayersFromDeadEnemy(deadEnemyId: string): void {
    this.state.players.forEach((player) => {
      if (!player.alive || player.targetId !== deadEnemyId) return;
      player.targetId = this.findNearestSelectableEnemy(player, deadEnemyId)?.state.id ?? "";
      if (!player.targetId) player.autoAttack = false;
    });
  }

  private findNearestSelectableEnemy(player: PlayerState, excludedId = ""): EnemyController | null {
    let best: EnemyController | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (enemy.state.id === excludedId || !this.isEnemySelectable(player, enemy)) continue;
      const d = Math.hypot(enemy.state.x - player.x, enemy.state.z - player.z);
      if (d < bestDistance) {
        best = enemy;
        bestDistance = d;
      }
    }
    return best;
  }

  private isEnemySelectable(player: PlayerState, enemy: EnemyController): boolean {
    if (!enemy.state.alive) return false;
    return Math.hypot(enemy.state.x - player.x, enemy.state.z - player.z) <= TARGET_SELECTION_RANGE;
  }

  private removeEnemy(enemy: EnemyController): void {
    this.deadEnemyDespawn.delete(enemy.state.id);
    this.state.enemies.delete(enemy.state.id);
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this.state.players.forEach((player) => {
      if (player.targetId === enemy.state.id) player.targetId = "";
      if (!player.targetId) player.autoAttack = false;
    });
  }

  private scheduleEnemyRemoval(enemy: EnemyController): void {
    this.deadEnemyDespawn.set(enemy.state.id, DEAD_ENEMY_DESPAWN_SECONDS);
  }

  private updateDeadEnemyDespawn(dt: number): void {
    for (const [enemyId, timeLeft] of this.deadEnemyDespawn) {
      const next = timeLeft - dt;
      if (next > 0) {
        this.deadEnemyDespawn.set(enemyId, next);
        continue;
      }
      const enemy = this.enemies.find((candidate) => candidate.state.id === enemyId);
      if (enemy) {
        enemy.state.actionState = "dead";
        this.removeEnemy(enemy);
      }
      else this.deadEnemyDespawn.delete(enemyId);
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
        this.clearAction(p);
      }
    });
  }

  private emitCombat(event: CombatEventMessage): void {
    this.broadcast(ServerMessage.CombatEvent, event);
  }

  private scheduleImpact(actionId: string, delaySeconds: number, resolve: () => void): void {
    this.pendingImpacts.push({ actionId, timeLeft: Math.max(0, delaySeconds), resolve });
  }

  private updatePendingImpacts(dt: number): void {
    const remaining: PendingImpact[] = [];
    for (const impact of this.pendingImpacts) {
      impact.timeLeft -= dt;
      if (impact.timeLeft <= 0) impact.resolve();
      else remaining.push(impact);
    }
    this.pendingImpacts = remaining;
  }

  private launchProjectile(actionId: string, source: PlayerState, target: EnemyState, resolve: ProjectileResolver): void {
    const distance = Math.hypot(target.x - source.x, target.z - source.z);
    const timing = projectileTiming(distance, 0, PROJECTILE_SPEED_UNITS_PER_SECOND);
    this.emitCombat({
      sourceId: source.id,
      targetId: target.id,
      amount: 0,
      kind: "skill",
      actionId,
      impactDelayMs: timing.travelTime * 1000,
    });
    this.pendingProjectiles.push(createPendingProjectile(actionId, source, target, resolve));
  }

  private updatePendingProjectiles(dt: number): void {
    if (this.pendingProjectiles.length === 0) return;
    const result = advancePendingProjectiles(this.pendingProjectiles, dt, (id) => this.resolveProjectileEntity(id));
    this.pendingProjectiles = result.remaining;
    for (const projectile of result.impacts) projectile.payload();
  }

  private resolveProjectileEntity(id: string): ProjectileEntity | undefined {
    const player = this.state.players.get(id);
    if (player) return { id: player.id, x: player.x, z: player.z, alive: player.alive };
    const enemy = this.state.enemies.get(id);
    if (enemy) return { id: enemy.id, x: enemy.x, z: enemy.z, alive: enemy.alive };
    return undefined;
  }

  private updateActionStates(): void {
    this.state.players.forEach((player) => {
      if (player.actionState !== "idle" && player.actionState !== "dead" && this.elapsedSeconds >= player.actionEndsAt) {
        this.clearAction(player);
      }
    });
    this.state.enemies.forEach((enemy) => {
      if (enemy.actionState !== "idle" && enemy.actionState !== "dying" && enemy.actionState !== "dead" && this.elapsedSeconds >= enemy.actionEndsAt) {
        this.clearAction(enemy);
      }
    });
  }

  private setAction(entity: ActionEntity, state: CombatActionState, duration: number, targetId: string, actionId: string): void {
    entity.actionState = state;
    entity.actionStartedAt = this.elapsedSeconds;
    entity.actionEndsAt = this.elapsedSeconds + Math.max(0, duration);
    entity.actionTargetId = targetId;
    entity.actionId = actionId;
  }

  private isCurrentAction(entity: ActionEntity, actionId: string): boolean {
    return isCombatActionCurrent(
      {
        actionState: entity.actionState as CombatActionState,
        actionId: entity.actionId,
        actionEndsAt: entity.actionEndsAt,
      },
      actionId,
      this.elapsedSeconds,
    );
  }

  private clearAction(entity: ActionEntity): void {
    entity.actionState = "idle";
    entity.actionStartedAt = this.elapsedSeconds;
    entity.actionEndsAt = this.elapsedSeconds;
    entity.actionTargetId = "";
    entity.actionId = "";
  }

  private nextActionId(): string {
    return `a${this.tick}-${this.actionSeq++}`;
  }

  private spawnInitialEnemies(): void {
    const points = this.dungeon.normalSpawns;
    points.slice(0, INITIAL_ENEMY_COUNT).forEach((pt) => this.spawnEnemy(GRUNT, pt.x, pt.z));
  }

  private spawnInitialElites(): void {
    const points = this.dungeon.eliteSpawns;
    points.slice(0, INITIAL_ELITE_COUNT).forEach((pt) => this.spawnEnemy(ELITE_GRUNT, pt.x, pt.z));
  }

  private spawnInitialBoss(): void {
    const point = this.dungeon.bossPortal;
    this.spawnEnemy(BOSS_BRUTE, point.x, point.z);
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
    this.clearAction(state);
    this.state.enemies.set(state.id, state);
    const controller = new EnemyController(state, def, x, z);
    this.enemies.push(controller);
    return controller;
  }

  private liveEnemyCount(): number {
    return this.enemies.reduce((n, e) => n + (e.state.alive && e.def.rank !== "boss" ? 1 : 0), 0);
  }

  private randomSpawnPoint(def: EnemyDef): { x: number; z: number } {
    const spawns = def.rank === "elite" ? this.dungeon.eliteSpawns : this.dungeon.normalSpawns;
    return spawns[Math.floor(Math.random() * spawns.length)] ?? this.dungeon.playerSpawn;
  }

  private ringSpawn(index: number): { x: number; z: number } {
    if (index === 0) return this.dungeon.playerSpawn;
    const angle = (index * Math.PI * 2) / 6;
    return {
      x: this.dungeon.playerSpawn.x + Math.cos(angle) * 2,
      z: this.dungeon.playerSpawn.z + Math.sin(angle) * 2,
    };
  }

  private facePlayerToEnemy(p: PlayerState, enemy: EnemyController): void {
    const dx = enemy.state.x - p.x;
    const dz = enemy.state.z - p.z;
    if (Math.hypot(dx, dz) > 1e-3) p.yaw = Math.atan2(dx, dz);
  }

  private autoFollowTarget(p: PlayerState, enemy: EnemyController, dt: number, stopRange: number): void {
    const dx = enemy.state.x - p.x;
    const dz = enemy.state.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len <= stopRange || len < 1e-4) return;
    const step = Math.min(Math.max(0, len - stopRange * 0.92), PLAYER_SPEED * dt);
    const nx = dx / len;
    const nz = dz / len;
    const nextX = p.x + nx * step;
    const nextZ = p.z + nz * step;
    if (isDungeonWalkable(nextX, nextZ, COLLISION_RADIUS, this.dungeon)) {
      p.x = nextX;
      p.z = nextZ;
    } else if (isDungeonWalkable(nextX, p.z, COLLISION_RADIUS, this.dungeon)) {
      p.x = nextX;
    } else if (isDungeonWalkable(p.x, nextZ, COLLISION_RADIUS, this.dungeon)) {
      p.z = nextZ;
    }
    p.yaw = Math.atan2(nx, nz);
  }
}

function angleDiff(a: number, b: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
