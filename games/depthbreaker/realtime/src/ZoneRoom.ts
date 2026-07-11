// Authoritative zone room. Server owns movement, combat, waves, boss portal,
// cooldowns, and class skills; clients send input/target/skill requests only.

import { Room, type Client } from "colyseus";
import {
  ZoneState,
  PlayerState,
  EnemyState,
  ItemSlotState,
  ResourceNodeState,
  SkillSlotState,
  HOTBAR_SLOTS,
  hotbarLayout,
  skillDef,
  type SkillDef,
  type SkillEffect,
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
  type EquipWeaponMessage,
  type UseItemMessage,
  type UseSkillMessage,
  type GatherNodeMessage,
  type BuyItemMessage,
  type SellItemMessage,
  type CombatActionState,
  type CombatEventMessage,
  type LootEventMessage,
  type WelcomeMessage,
  DEPTHBREAKER_DUNGEON,
  buildDungeon,
  isDungeonWalkable,
  MARKET_STOCK,
  MARKET_RANGE,
  GATHER_RANGE,
  type DungeonMapDefinition,
} from "@depthbreaker/protocol";
import {
  resolveDamage,
  isOnGlobalCooldown,
  beginGlobalCooldown,
  levelForTotalXp,
  maxCurrencyForDepth,
  maxXpForDepth,
  applyHeal,
  POTION_HEAL_FRACTION,
  POTION_COOLDOWN_SECONDS,
  DeterministicRng,
  deriveStreamSeed,
  RngStream,
  rollLoot,
  LOOT_TABLES,
  addStacked,
  removeAt,
  removeStacked,
  itemDef,
  stackSizeOf,
  weaponAttack,
  canEquipWeapon,
  type InvSlot,
  type LootRank,
  type ItemClassId,
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
const BAG_CAPACITY = 16;
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
// Per-skill tuning (cooldowns, damage, ranges, durations) lives in the shared
// skill table: packages/protocol/src/skills.ts. This file only executes effects.
const TARGET_SELECTION_RANGE = 18;

// Mining (WoCC pickUpObject-style harvest, with a short cast). Ranges + the
// stall stock are shared with the client via @depthbreaker/protocol market.ts.
const GATHER_SECONDS = 1.4;
const NODE_RESPAWN_SECONDS = 35;
/** Ticketless dev joins get a local in-memory wallet so offline play works. */
const DEV_STARTING_GOLD = 50;

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
  if (!p.weaponId) return Math.max(1, Math.round(rt.profile.attackRaw * 0.45));
  return rt.profile.attackRaw + weaponAttack(p.weaponId);
}

interface PlayerRuntime {
  input: { moveX: number; moveZ: number; yaw: number };
  attackCooldown: number;
  potionCooldown: number;
  /** Per-skill cooldowns keyed by skillId; entries are deleted at <= 0. */
  cooldowns: Map<string, number>;
  gcdRemaining: number;
  shieldSeconds: number;
  frostSeconds: number;
  frostTick: number;
  /** Aura params captured from the aura_dot effect at cast time. */
  frostAura: { radius: number; tick: number; damage: number };
  /** Bulwark damage-reduction buff (0 value = inactive). */
  bulwarkSeconds: number;
  bulwarkValue: number;
  respawnTimer: number;
  profile: ClassProfile;
  runId: string | null;
  characterId: string;
  /** Account id from the join ticket; "" for ticketless dev joins. */
  accountId: string;
  /** Dev-only in-memory gold used when accountId is "" (no backend wallet). */
  localGold: number;
  /** Serializes market transactions per player across the backend await. */
  marketBusy: boolean;
  /** Persistent total XP from the join ticket; 0 for ticketless dev joins. */
  baseTotalXp: number;
  earnedXp: number;
  earnedCurrency: number;
  ticketed: boolean;
  /** Authoritative bag; mirrored into PlayerState.inventory via syncBag(). */
  bag: InvSlot[];
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
  // Independent Loot substream, seeded once from the run seed in ensureSeeded().
  private lootRng: DeterministicRng = new DeterministicRng(0);

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
      if (slot >= 0 && slot < HOTBAR_SLOTS) this.castSkillSlot(client.sessionId, slot);
    });

    this.onMessage(CM.ToggleWeapon, (client, message: ToggleWeaponMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      player.weaponId = message.equipped ? defaultWeaponForClass(player.classId as ClassId) : "";
    });

    this.onMessage(CM.EquipWeapon, (client, message: EquipWeaponMessage) => {
      this.equipWeaponFromBag(client.sessionId, message?.itemId ?? "");
    });

    this.onMessage(CM.UseItem, (client, message: UseItemMessage) => {
      this.useBagItem(client.sessionId, message?.index ?? -1);
    });

    this.onMessage(CM.GatherNode, (client, message: GatherNodeMessage) => {
      this.gatherNode(client.sessionId, message?.nodeId ?? "");
    });

    this.onMessage(CM.BuyItem, (client, message: BuyItemMessage) => {
      void this.buyItem(client.sessionId, message?.itemId ?? "");
    });

    this.onMessage(CM.SellItem, (client, message: SellItemMessage) => {
      void this.sellItem(client.sessionId, message?.index ?? -1);
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
    // Persistent MMO-lite level: the join ticket carries the character's total
    // XP; in-run kills add on top (awardKill). Ticketless dev joins start Lv1.
    player.level = levelForTotalXp(auth.claims?.totalXp ?? 0);
    player.alive = true;
    const spawn = this.ringSpawn(this.state.players.size);
    player.x = spawn.x;
    player.z = spawn.z;
    this.state.players.set(client.sessionId, player);

    const runtime: PlayerRuntime = {
      input: { moveX: 0, moveZ: 0, yaw: 0 },
      attackCooldown: 0,
      potionCooldown: 0,
      cooldowns: new Map(),
      gcdRemaining: 0,
      shieldSeconds: 0,
      frostSeconds: 0,
      frostTick: 0,
      frostAura: { radius: 0, tick: 0.5, damage: 0 },
      bulwarkSeconds: 0,
      bulwarkValue: 0,
      respawnTimer: 0,
      profile: classProfile(auth.classId),
      runId: auth.claims?.runId ?? null,
      characterId: auth.claims?.characterId ?? "",
      accountId: auth.claims?.accountId ?? "",
      localGold: auth.claims ? 0 : DEV_STARTING_GOLD,
      marketBusy: false,
      baseTotalXp: auth.claims?.totalXp ?? 0,
      earnedXp: 0,
      earnedCurrency: 0,
      ticketed: auth.claims !== null,
      bag: [{ itemId: "health_potion", count: 3 }],
    };
    // Full auto-attack period is fixed per class; the swing timer itself
    // (swingCooldown) is mirrored each frame in updateCooldowns.
    player.swingInterval = runtime.profile.attackInterval;
    this.buildHotbar(player);
    this.runtimes.set(client.sessionId, runtime);
    this.syncBag(player, runtime);

    // Wallet balance for the HUD/market: persistent (backend) for ticketed
    // joins, local dev gold otherwise. Async — guard against an early leave.
    if (runtime.accountId) {
      void this.reporter.walletBalance(runtime.accountId).then((res) => {
        const live = this.state.players.get(client.sessionId);
        if (live && res.ok && res.balance !== undefined) live.gold = res.balance;
      });
    } else {
      player.gold = runtime.localGold;
    }

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
    this.lootRng = new DeterministicRng(deriveStreamSeed(this.state.seed, RngStream.Loot));
    this.dungeon = buildDungeon(this.state.seed, this.state.depth);
    this.spawnInitialEnemies();
    this.spawnInitialElites();
    this.spawnInitialBoss();
    // Mining nodes come straight from the seeded map definition.
    for (const def of this.dungeon.resourceNodes) {
      const node = new ResourceNodeState();
      node.id = def.id;
      node.kind = def.kind;
      node.x = def.x;
      node.z = def.z;
      this.state.nodes.set(node.id, node);
    }
    this.initialSpawnsDone = true;
  }

  /** Depleted node id -> seconds until it comes back. */
  private nodeRespawns = new Map<string, number>();

  private updateNodeRespawns(dt: number): void {
    for (const [nodeId, remaining] of this.nodeRespawns) {
      const next = remaining - dt;
      if (next > 0) {
        this.nodeRespawns.set(nodeId, next);
        continue;
      }
      this.nodeRespawns.delete(nodeId);
      const node = this.state.nodes.get(nodeId);
      if (node) node.depleted = false;
    }
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
    this.updateNodeRespawns(dt);
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
      rt.gcdRemaining = Math.max(0, rt.gcdRemaining - dt);
      rt.shieldSeconds = Math.max(0, rt.shieldSeconds - dt);
      rt.frostSeconds = Math.max(0, rt.frostSeconds - dt);
      rt.bulwarkSeconds = Math.max(0, rt.bulwarkSeconds - dt);
      // Per-skill cooldowns: tick down and drop finished entries (WoCC pattern).
      for (const [skillId, remaining] of rt.cooldowns) {
        const next = remaining - dt;
        if (next <= 0) rt.cooldowns.delete(skillId);
        else rt.cooldowns.set(skillId, next);
      }
      const p = this.state.players.get(id);
      if (!p) return;
      p.potionCooldown = rt.potionCooldown;
      p.gcdRemaining = rt.gcdRemaining;
      // Swing timer is advanced in updatePlayerAttacks; surface it for the HUD bar.
      p.swingCooldown = rt.attackCooldown;
      p.shieldSeconds = rt.shieldSeconds;
      p.frostSeconds = rt.frostSeconds;
      // Mirror per-skill cooldowns + level unlocks into the synced hotbar.
      for (const slot of p.hotbar) {
        if (!slot.skillId) continue;
        slot.cooldownRemaining = rt.cooldowns.get(slot.skillId) ?? 0;
        const def = skillDef(slot.skillId);
        slot.unlocked = !!def && def.learnLevel <= p.level;
      }
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
      rt.frostTick = rt.frostAura.tick;
      const p = this.state.players.get(id);
      if (!p || !p.alive) return;
      for (const enemy of this.enemies) {
        if (!enemy.state.alive) continue;
        const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
        if (d > rt.frostAura.radius) continue;
        this.damageEnemy(id, rt, p, enemy, rt.frostAura.damage, "skill");
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

  /** Rewrite PlayerState.inventory from the authoritative rt.bag, padded to
   *  BAG_CAPACITY with empty slots so the client always sees a fixed grid. */
  private syncBag(p: PlayerState, rt: PlayerRuntime): void {
    const inv = p.inventory;
    for (let i = 0; i < BAG_CAPACITY; i++) {
      const src = rt.bag[i];
      let slot = inv[i];
      if (!slot) {
        slot = new ItemSlotState();
        inv.push(slot);
      }
      slot.itemId = src?.itemId ?? "";
      slot.count = src?.count ?? 0;
      slot.rarity = src ? itemDef(src.itemId)?.rarity ?? "" : "";
    }
    while (inv.length > BAG_CAPACITY) inv.pop();
  }

  /** Equip a weapon from the bag; the previously equipped weapon returns to the bag. */
  private equipWeaponFromBag(playerId: string, itemId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    if (!canEquipWeapon(p.classId as ItemClassId, itemId)) return;
    if (!removeStacked(rt.bag, itemId, 1)) return;
    const previous = p.weaponId;
    p.weaponId = itemId;
    if (previous && itemDef(previous)?.kind === "weapon") {
      addStacked(rt.bag, BAG_CAPACITY, previous, 1);
    }
    this.syncBag(p, rt);
  }

  /** Consume the potion/food in bag slot `index`, reusing the potion heal path. */
  private useBagItem(playerId: string, index: number): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    const slot = rt.bag[index];
    if (!slot) return;
    const def = itemDef(slot.itemId);
    if (!def || (def.kind !== "potion" && def.kind !== "food")) return;
    if (rt.potionCooldown > 0 || p.hp >= p.maxHp) return;
    const { newHp, effective } = applyHeal(p.hp, p.maxHp, def.healFraction ?? 0);
    p.hp = newHp;
    rt.potionCooldown = POTION_COOLDOWN_SECONDS;
    p.potionCooldown = POTION_COOLDOWN_SECONDS;
    removeAt(rt.bag, index, 1);
    this.syncBag(p, rt);
    this.applyHealThreat(playerId, effective);
    this.setAction(p, "skill", 0.35, p.id, this.nextActionId());
    this.emitCombat({ sourceId: p.id, targetId: p.id, amount: -effective, kind: "heal", actionId: p.actionId });
  }

  /** Whether the bag can accept one unit of an item without dropping it. */
  private bagHasRoomFor(bag: InvSlot[], itemId: string): boolean {
    const stack = stackSizeOf(itemId);
    if (bag.some((slot) => slot.itemId === itemId && slot.count < stack)) return true;
    return bag.filter((slot) => slot.count > 0).length < BAG_CAPACITY;
  }

  /**
   * Mining: WoCC's pickUpObject ladder with a short cast. Guards run twice —
   * once at click, again at impact — so a node sniped by another player (or a
   * mid-cast death) yields nothing.
   */
  private gatherNode(playerId: string, nodeId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    const node = this.state.nodes.get(nodeId);
    if (!rt || !p || !p.alive || !node || node.depleted) return;
    if (Math.hypot(node.x - p.x, node.z - p.z) > GATHER_RANGE) return;

    const actionId = this.nextActionId();
    // Action window outlives the impact tick — an impact scheduled exactly at
    // the action's end loses the isCurrentAction race by one frame.
    this.setAction(p, "skill", GATHER_SECONDS + 0.4, nodeId, actionId);
    this.scheduleImpact(actionId, GATHER_SECONDS, () => {
      const source = this.state.players.get(playerId);
      const liveRt = this.runtimes.get(playerId);
      const liveNode = this.state.nodes.get(nodeId);
      if (!source || !liveRt || !source.alive || !liveNode || liveNode.depleted) return;
      if (!this.isCurrentAction(source, actionId)) return;
      if (Math.hypot(liveNode.x - source.x, liveNode.z - source.z) > GATHER_RANGE + 0.75) return;

      // Yields: iron veins give 1-2 ore; crystal veins give a shard + 25% ore.
      const grants: { itemId: string; count: number }[] = [];
      if (liveNode.kind === "crystal_vein") {
        grants.push({ itemId: "crystal_shard", count: 1 });
        if (Math.random() < 0.25) grants.push({ itemId: "iron_ore", count: 1 });
      } else {
        grants.push({ itemId: "iron_ore", count: 1 + (Math.random() < 0.5 ? 1 : 0) });
      }

      // Bag full for the primary yield → gather fails, node stays up (WoCC).
      if (!this.bagHasRoomFor(liveRt.bag, grants[0]!.itemId)) return;
      for (const grant of grants) {
        const leftover = addStacked(liveRt.bag, BAG_CAPACITY, grant.itemId, grant.count);
        const deposited = grant.count - leftover;
        if (deposited > 0) {
          const def = itemDef(grant.itemId);
          const loot: LootEventMessage = { playerId: source.id, itemId: grant.itemId, rarity: def?.rarity ?? "" };
          this.broadcast(ServerMessage.LootEvent, loot);
        }
      }
      this.syncBag(source, liveRt);
      liveNode.depleted = true;
      this.nodeRespawns.set(nodeId, NODE_RESPAWN_SECONDS);
    });
  }

  /** True when the player stands at the market stall. */
  private nearMarket(p: PlayerState): boolean {
    const stall = this.dungeon.marketStall;
    return Math.hypot(stall.x - p.x, stall.z - p.z) <= MARKET_RANGE;
  }

  /**
   * Gold movement against the persistent wallet (backend, conditional SQL) or
   * the local dev wallet for ticketless joins. Returns the new balance, or
   * null when the movement was refused (insufficient funds / backend down).
   */
  private async moveGold(rt: PlayerRuntime, amount: number, reason: string): Promise<number | null> {
    if (!rt.accountId) {
      const next = rt.localGold + amount;
      if (next < 0) return null;
      rt.localGold = next;
      return next;
    }
    const res =
      amount < 0
        ? await this.reporter.walletDebit(rt.accountId, -amount, reason)
        : await this.reporter.walletCredit(rt.accountId, amount, reason);
    return res.ok && res.balance !== undefined ? res.balance : null;
  }

  /** WoCC buyItem ladder: validate everything, mutate gold, then grant. */
  private async buyItem(playerId: string, itemId: string): Promise<void> {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive || rt.marketBusy) return;
    if (!this.nearMarket(p)) return;
    if (!MARKET_STOCK.includes(itemId)) return;
    const def = itemDef(itemId);
    if (!def?.buyValue) return;
    if (!this.bagHasRoomFor(rt.bag, itemId)) return;

    rt.marketBusy = true;
    try {
      const balance = await this.moveGold(rt, -def.buyValue, `buy:${itemId}`);
      if (balance === null) return; // insufficient / backend unreachable — nothing granted
      const live = this.state.players.get(playerId);
      if (!live) {
        // Player left mid-transaction: undo the debit so no gold evaporates.
        void this.moveGold(rt, def.buyValue, `refund:${itemId}`);
        return;
      }
      const leftover = addStacked(rt.bag, BAG_CAPACITY, itemId, 1);
      if (leftover > 0) {
        // Bag filled up during the await (e.g. loot landed): refund.
        const refunded = await this.moveGold(rt, def.buyValue, `refund:${itemId}`);
        if (refunded !== null) live.gold = refunded;
        return;
      }
      this.syncBag(live, rt);
      live.gold = balance;
      const loot: LootEventMessage = { playerId: live.id, itemId, rarity: def.rarity };
      this.broadcast(ServerMessage.LootEvent, loot);
    } finally {
      rt.marketBusy = false;
    }
  }

  /** Sell one unit from a bag slot at the item's sellValue. */
  private async sellItem(playerId: string, index: number): Promise<void> {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive || rt.marketBusy) return;
    if (!this.nearMarket(p)) return;
    const slot = rt.bag[index];
    if (!slot || slot.count <= 0) return;
    const def = itemDef(slot.itemId);
    if (!def?.sellValue) return;

    rt.marketBusy = true;
    try {
      // Remove first, credit after — if the credit fails (backend down), the
      // item is returned, so goods and gold can never both exist.
      const soldItemId = slot.itemId;
      if (!removeAt(rt.bag, index, 1)) return;
      const balance = await this.moveGold(rt, def.sellValue, `sell:${soldItemId}`);
      const live = this.state.players.get(playerId);
      if (balance === null) {
        addStacked(rt.bag, BAG_CAPACITY, soldItemId, 1);
        if (live) this.syncBag(live, rt);
        return;
      }
      if (live) {
        this.syncBag(live, rt);
        live.gold = balance;
      }
    } finally {
      rt.marketBusy = false;
    }
  }

  /** Seed the synced 10-slot hotbar from the class's fixed layout. */
  private buildHotbar(p: PlayerState): void {
    for (const skillId of hotbarLayout(p.classId as ClassId)) {
      const slot = new SkillSlotState();
      slot.skillId = skillId;
      const def = skillId ? skillDef(skillId) : undefined;
      slot.unlocked = !!def && def.learnLevel <= p.level;
      p.hotbar.push(slot);
    }
  }

  /**
   * Cast the skill in a hotbar slot. WoCC-style fail-fast guard ladder:
   * dead -> GCD (silent) -> per-skill cooldown -> unlocked -> target/range.
   * Cooldown + GCD are only committed once the cast is guaranteed to happen.
   */
  private castSkillSlot(playerId: string, slotIndex: number): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    const slot = p.hotbar[slotIndex];
    if (!slot?.skillId) return;
    const def = skillDef(slot.skillId);
    if (!def) return;

    // basic_attack is a pure toggle — no cooldown, no GCD, no action state.
    if (def.effects.some((e) => e.type === "basic_attack")) {
      if (p.targetId) p.autoAttack = !p.autoAttack;
      return;
    }

    if (!def.offGcd && isOnGlobalCooldown(rt.gcdRemaining)) return;
    if (rt.cooldowns.has(def.id)) return;
    if (def.learnLevel > p.level) return;

    // Guards that must not waste the cooldown: targeted effects with no valid
    // target (or target beyond reach).
    const targeted = def.effects.find(
      (e): e is Extract<SkillEffect, { type: "projectile_aoe" | "dash_strike" | "execute" }> =>
        e.type === "projectile_aoe" || e.type === "dash_strike" || e.type === "execute",
    );
    let target: EnemyController | null = null;
    if (targeted) {
      target = this.enemies.find((e) => e.state.id === p.targetId && e.state.alive) ?? null;
      if (!target) return;
      if (targeted.type !== "projectile_aoe") {
        const d = Math.hypot(target.state.x - p.x, target.state.z - p.z);
        if (d > targeted.range + 0.5) return;
      }
    }

    // Commit: per-skill cooldown + GCD, then execute the effect list.
    if (def.cooldown > 0) rt.cooldowns.set(def.id, def.cooldown);
    if (!def.offGcd) this.startGlobalCooldown(rt, p);
    for (const effect of def.effects) this.runEffect(playerId, rt, p, effect, target);
  }

  /** Charge the shared global cooldown after a class skill commits to casting. */
  private startGlobalCooldown(rt: PlayerRuntime, p: PlayerState): void {
    rt.gcdRemaining = beginGlobalCooldown();
    p.gcdRemaining = rt.gcdRemaining;
  }

  /**
   * The single effect executor (WoCC effect_dispatch style). Every case reads
   * its tuning from the effect payload — no per-skill constants in this file.
   */
  private runEffect(
    playerId: string,
    rt: PlayerRuntime,
    p: PlayerState,
    effect: SkillEffect,
    target: EnemyController | null,
  ): void {
    switch (effect.type) {
      case "basic_attack":
        // Handled as a toggle in castSkillSlot; nothing to execute.
        return;

      case "self_immunity": {
        rt.shieldSeconds = effect.duration;
        p.shieldSeconds = rt.shieldSeconds;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId });
        return;
      }

      case "self_buff": {
        rt.bulwarkSeconds = effect.duration;
        rt.bulwarkValue = effect.value;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId });
        return;
      }

      case "aura_dot": {
        rt.frostSeconds = effect.duration;
        rt.frostTick = 0;
        rt.frostAura = { radius: effect.radius, tick: effect.tick, damage: effect.damage };
        p.frostSeconds = rt.frostSeconds;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId });
        return;
      }

      case "melee_cone": {
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
            if (d > effect.range || d < 1e-3) continue;
            const angle = Math.atan2(dx, dz);
            if (Math.abs(angleDiff(source.yaw, angle)) > effect.halfAngle) continue;
            hit = true;
            this.damageEnemy(playerId, liveRt, source, enemy, effect.damage, "skill", actionId);
          }
          if (!hit) this.emitCombat({ sourceId: source.id, targetId: source.id, amount: 0, kind: "skill", actionId });
        });
        return;
      }

      case "radial_aoe": {
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.scheduleImpact(actionId, DEFAULT_SKILL_TIMING.windup, () => {
          const source = this.state.players.get(playerId);
          const liveRt = this.runtimes.get(playerId);
          if (!source || !liveRt || !source.alive || !this.isCurrentAction(source, actionId)) return;
          let hit = false;
          for (const enemy of this.enemies) {
            if (!enemy.state.alive) continue;
            const d = Math.hypot(enemy.state.x - source.x, enemy.state.z - source.z);
            if (d > effect.radius) continue;
            hit = true;
            this.damageEnemy(playerId, liveRt, source, enemy, effect.damage, "skill", actionId);
          }
          if (!hit) this.emitCombat({ sourceId: source.id, targetId: source.id, amount: 0, kind: "skill", actionId });
        });
        return;
      }

      case "dash_strike": {
        if (!target) return;
        // Gap-close: land just outside the target's collision, staying walkable.
        const dx = target.state.x - p.x;
        const dz = target.state.z - p.z;
        const d = Math.hypot(dx, dz);
        const stop = 1.1;
        if (d > stop) {
          const nx = p.x + (dx / d) * (d - stop);
          const nz = p.z + (dz / d) * (d - stop);
          if (isDungeonWalkable(nx, nz, COLLISION_RADIUS, this.dungeon)) {
            p.x = nx;
            p.z = nz;
          }
        }
        this.facePlayerToEnemy(p, target);
        const targetId = target.state.id;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), targetId, actionId);
        this.scheduleImpact(actionId, DEFAULT_SKILL_TIMING.windup, () => {
          const source = this.state.players.get(playerId);
          const liveRt = this.runtimes.get(playerId);
          const live = this.enemies.find((e) => e.state.id === targetId);
          if (!source || !liveRt || !source.alive || !live?.state.alive || !this.isCurrentAction(source, actionId)) return;
          const reach = Math.hypot(live.state.x - source.x, live.state.z - source.z);
          if (reach > 2.5) return;
          this.damageEnemy(playerId, liveRt, source, live, effect.damage, "skill", actionId);
        });
        return;
      }

      case "execute": {
        if (!target) return;
        this.facePlayerToEnemy(p, target);
        const targetId = target.state.id;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), targetId, actionId);
        this.scheduleImpact(actionId, DEFAULT_SKILL_TIMING.windup, () => {
          const source = this.state.players.get(playerId);
          const liveRt = this.runtimes.get(playerId);
          const live = this.enemies.find((e) => e.state.id === targetId);
          if (!source || !liveRt || !source.alive || !live?.state.alive || !this.isCurrentAction(source, actionId)) return;
          const reach = Math.hypot(live.state.x - source.x, live.state.z - source.z);
          if (reach > effect.range + 0.75) return;
          const lowHp = live.state.hp / Math.max(1, live.state.maxHp) < effect.lowHpThreshold;
          const raw = lowHp ? effect.damage * effect.bonusMult : effect.damage;
          this.damageEnemy(playerId, liveRt, source, live, raw, "skill", actionId);
        });
        return;
      }

      case "projectile_aoe": {
        if (!target) return;
        this.facePlayerToEnemy(p, target);
        const targetId = target.state.id;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), targetId, actionId);
        this.scheduleImpact(actionId, DEFAULT_SKILL_TIMING.windup, () => {
          const source = this.state.players.get(playerId);
          const liveRt = this.runtimes.get(playerId);
          const livePrimary = this.enemies.find((e) => e.state.id === targetId);
          if (!source || !liveRt || !source.alive || !livePrimary?.state.alive || !this.isCurrentAction(source, actionId)) return;
          this.launchProjectile(actionId, source, livePrimary.state, () => {
            const liveSource = this.state.players.get(playerId);
            const rtNow = this.runtimes.get(playerId);
            const impactCenter = this.enemies.find((e) => e.state.id === targetId);
            if (!liveSource || !rtNow || !liveSource.alive || !impactCenter?.state.alive) return;
            for (const enemy of this.enemies) {
              if (!enemy.state.alive) continue;
              const d = Math.hypot(enemy.state.x - impactCenter.state.x, enemy.state.z - impactCenter.state.z);
              if (d <= effect.radius) this.damageEnemy(playerId, rtNow, liveSource, enemy, effect.damage, "skill", actionId);
            }
          });
        });
        return;
      }
    }
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
    let dmg = resolveDamage(enemy.def.attackDamage, playerArmor, enemy.def.level, false);
    // Bulwark: flat post-mitigation damage reduction while the buff is up.
    if (rt.bulwarkSeconds > 0 && rt.bulwarkValue > 0) {
      dmg = Math.max(1, Math.round(dmg * (1 - rt.bulwarkValue)));
    }
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
      this.rollKillLoot(rt, p, enemy.def.rank as LootRank);
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

  /** Roll a drop for the killer off the rank's loot table, deposit it in the bag,
   *  and announce it for a pickup toast. Overflow is silently dropped for the MVP. */
  private rollKillLoot(rt: PlayerRuntime, p: PlayerState, rank: LootRank): void {
    const table = LOOT_TABLES[rank];
    if (!table) return;
    const rolled = rollLoot(this.lootRng, table);
    if (!rolled) return;
    const leftover = addStacked(rt.bag, BAG_CAPACITY, rolled.baseItemId, 1);
    if (leftover > 0) return; // bag full: no deposit, no toast
    this.syncBag(p, rt);
    const loot: LootEventMessage = { playerId: p.id, itemId: rolled.baseItemId, rarity: rolled.rarity };
    this.broadcast(ServerMessage.LootEvent, loot);
  }

  private awardKill(rt: PlayerRuntime, p: PlayerState, xp: number, currency: number): void {
    rt.earnedXp += xp;
    rt.earnedCurrency += currency;
    p.runXp += xp;
    // Level continues from the character's persistent base within the run;
    // unlocks earned mid-run persist because run XP is credited to total_xp
    // by /internal/runs/:id/finish.
    p.level = levelForTotalXp(rt.baseTotalXp + p.runXp);
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
