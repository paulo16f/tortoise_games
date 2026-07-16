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
  PLAYER_COLLISION_RADIUS,
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
  type FishHereMessage,
  type CraftMessage,
  type BuyItemMessage,
  type SellItemMessage,
  type StashDepositMessage,
  type StashWithdrawMessage,
  type StashMessage,
  type ClaimDailyMessage,
  type DailiesMessage,
  type BuySkinMessage,
  type EquipSkinMessage,
  type SkinsMessage,
  type ChatMessage,
  type SpinnerMessage,
  type SpinResultMessage,
  type TelegraphMessage,
  type CombatActionState,
  type CombatEventMessage,
  type LootEventMessage,
  type WelcomeMessage,
  DEPTHBREAKER_DUNGEON,
  buildDungeon,
  isDungeonWalkable,
  nearestDungeonWalkablePoint,
  groundHeightAt,
  MARKET_STOCK,
  MARKET_RANGE,
  GATHER_RANGE,
  GATHER_CAST_SECONDS,
  FISH_CAST_SECONDS,
  COOK_RANGE,
  STASH_SLOT_CAP,
  STASH_STACK_CAP,
  FOUNTAIN_RADIUS,
  FOUNTAIN_HEAL_PER_SECOND,
  type DungeonMapDefinition,
} from "@depthbreaker/protocol";
import {
  resolveDamage,
  isOnGlobalCooldown,
  beginGlobalCooldown,
  levelForTotalXp,
  maxCurrencyForRun,
  maxXpForRun,
  dailyQuestsFor,
  dateKeyUTC,
  type DailyQuestKind,
  skinDef,
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
  spendUse,
  findToolIndex,
  itemMaxUses,
  DEATH_DURABILITY_COST,
  forgeRecipe,
  REPAIR_WEAPON_ID,
  repairCost,
  countItem,
  cookingRecipe,
  itemDef,
  stackSizeOf,
  weaponAttack,
  weaponAttackSpeed,
  weaponCritBonus,
  weaponReach,
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
import { EnemyController, GRUNT, SWARMER, ELITE_GRUNT, BOSS_BRUTE, AREA_ROSTERS, COLISEUM_BOSS, coliseumBossForTier, type EnemyDef, type CombatTarget } from "./enemies.js";
import { verifyJoinTicket, type JoinTicketClaims } from "./joinTicket.js";
import { BackendReporter } from "./backendReporter.js";
import { loadConfig, type RealtimeConfig } from "./config.js";

// Shared with the client's movement prediction (identical wall clamps).
const COLLISION_RADIUS = PLAYER_COLLISION_RADIUS;
const BAG_CAPACITY = 16;
const PLAYER_CRIT_CHANCE = 0.15;
const INITIAL_ENEMY_COUNT = 3;
const INITIAL_ELITE_COUNT = 1;
const MAX_LIVE_ENEMIES = 8;
const DEAD_ENEMY_DESPAWN_SECONDS = ENEMY_DYING_SECONDS;
const WAVE_INTERVAL_SECONDS = 12;
const ELITE_CHANCE = 0.2;
const BOSS_PORTAL_INTERVAL_SECONDS = 75;
const BOSS_PORTAL_COUNTDOWN_SECONDS = 30;
// Per-skill tuning (cooldowns, damage, ranges, durations) lives in the shared
// skill table: packages/protocol/src/skills.ts. This file only executes effects.
const TARGET_SELECTION_RANGE = 18;
// Ability input buffer: a skill pressed within this window of becoming castable
// is queued and fires the instant the GCD/cooldown clears, instead of being
// dropped — the ARPG "the input took" feel (audit: combat-server #1).
const INPUT_BUFFER_SECONDS = 0.6;

// Mining (WoCC pickUpObject-style harvest, with a short cast). Ranges, cast
// time, and stall stock are shared with the client via protocol market.ts.
const NODE_RESPAWN_SECONDS = 35;
/** Ticketless dev joins get a local in-memory wallet so offline play works. */
const DEV_STARTING_GOLD = 50;

interface ClassProfile {
  attackRaw: number;
  attackInterval: number;
  attackRange: number;
  maxHp: number;
  /** True when basic attacks fire a projectile (casters) vs melee. */
  ranged: boolean;
}

function classProfile(classId: ClassId): ClassProfile {
  switch (classId) {
    case "necromancer":
      return { attackRaw: 14, attackInterval: 1.1, attackRange: 15, maxHp: 120, ranged: true };
    case "cleric":
      return { attackRaw: 12, attackInterval: 1.1, attackRange: 9, maxHp: 130, ranged: true };
    case "reaper":
      return { attackRaw: 16, attackInterval: 1.2, attackRange: 3.0, maxHp: 135, ranged: false };
    case "knight":
    default:
      return { attackRaw: 11, attackInterval: 1.0, attackRange: 2.6, maxHp: 170, ranged: false };
  }
}

function defaultWeaponForClass(classId: ClassId): string {
  return classId === "necromancer" || classId === "cleric" ? "ash_staff" : "iron_sword";
}

function basicAttackRaw(p: PlayerState, rt: PlayerRuntime): number {
  if (!p.weaponId) return Math.max(1, Math.round(rt.profile.attackRaw * 0.45));
  return rt.profile.attackRaw + weaponAttack(p.weaponId);
}

/** Effective swing period after the equipped weapon's speed multiplier. */
function swingIntervalFor(profile: ClassProfile, weaponId: string): number {
  return profile.attackInterval / weaponAttackSpeed(weaponId);
}

/** Effective melee reach after the equipped weapon's reach bonus. */
function attackRangeFor(profile: ClassProfile, weaponId: string): number {
  return profile.attackRange + weaponReach(weaponId);
}

/** Effective crit chance after the equipped weapon's crit bonus. */
function critChanceFor(weaponId: string): number {
  return PLAYER_CRIT_CHANCE + weaponCritBonus(weaponId);
}

interface PlayerRuntime {
  input: { moveX: number; moveZ: number; yaw: number };
  attackCooldown: number;
  /**
   * "I clicked this target, chase it into range for me." Set true when the
   * player engages (target+auto-attack), cleared the moment they take manual
   * movement control. Auto-attack itself never drops on movement — this only
   * gates server auto-follow, so strafing/kiting keeps you attacking in range
   * without the server yanking you back to the target when you step away.
   */
  engaging: boolean;
  potionCooldown: number;
  /** Per-skill cooldowns keyed by skillId; entries are deleted at <= 0. */
  cooldowns: Map<string, number>;
  gcdRemaining: number;
  /** Buffered hotbar slot pressed while gated (GCD/cooldown), -1 = none. */
  queuedSlot: number;
  /** elapsedSeconds when the buffered press was captured (for the buffer window). */
  queuedAt: number;
  shieldSeconds: number;
  frostSeconds: number;
  frostTick: number;
  /** Aura params captured from the aura_dot effect at cast time (skillId drives VFX/SFX). */
  frostAura: { radius: number; tick: number; damage: number; skillId: string };
  /** Bulwark damage-reduction buff (0 value = inactive). */
  bulwarkSeconds: number;
  bulwarkValue: number;
  /** Blessing damage-amp buff: outgoing damage ×(1+ampValue) while ampSeconds>0. */
  ampSeconds: number;
  ampValue: number;
  respawnTimer: number;
  /** Durability left on the EQUIPPED weapon (moves with the item on equip/unequip). -1 = n/a. */
  weaponUses: number;
  profile: ClassProfile;
  runId: string | null;
  characterId: string;
  /** Account id from the join ticket; "" for ticketless dev joins. */
  accountId: string;
  /** Dev-only in-memory gold used when accountId is "" (no backend wallet). */
  localGold: number;
  /** Dev-only in-memory stash used when accountId is "" (no backend stash). */
  localStash: Map<string, number>;
  /** Serializes market/stash transactions per player across the backend await. */
  marketBusy: boolean;
  /** Serializes spin requests per player across the backend await (anti double-spin). */
  spinBusy: boolean;
  /** elapsedSeconds of the player's last accepted chat line (rate limit). */
  lastChatAt: number;
  /** Buffered daily-quest progress (questId -> pending delta), flushed periodically. */
  dailyBuffer: Map<string, number>;
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
  // Coliseum world boss: each slaying levels it up; it re-forms tougher.
  private coliseumTier = 0;
  private coliseumRespawnTimer = 0;
  private waveCount = 0;
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
      // Taking manual movement control ends "chase my target" auto-follow, but
      // KEEPS auto-attack on: you can strafe/kite and still swing when in range.
      if (Math.hypot(rt.input.moveX, rt.input.moveZ) > 0.01) rt.engaging = false;
    });

    this.onMessage(CM.SetTarget, (client, message: SetTargetMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const rt = this.runtimes.get(client.sessionId);
      const id = message.targetId ?? "";
      if (id === "") {
        player.targetId = "";
        player.autoAttack = false;
        if (rt) rt.engaging = false;
      }
      else {
        const enemy = this.enemies.find((e) => e.state.id === id);
        if (enemy && this.isEnemySelectable(player, enemy)) {
          player.targetId = id;
          player.autoAttack = message.autoAttack ?? player.autoAttack;
          // Clicking a target to auto-attack it means "chase it into range".
          if (rt && player.autoAttack) rt.engaging = true;
        }
      }
    });

    this.onMessage(CM.SetAutoAttack, (client, message: SetAutoAttackMessage) => {
      const player = this.state.players.get(client.sessionId);
      const rt = this.runtimes.get(client.sessionId);
      if (!player || !player.alive || !player.targetId) return;
      player.autoAttack = !!message.enabled;
      if (rt && player.autoAttack) rt.engaging = true;
    });

    this.onMessage(CM.UseSkill, (client, message: UseSkillMessage) => {
      const slot = message?.slot ?? -1;
      if (slot >= 0 && slot < HOTBAR_SLOTS) this.castSkillSlot(client.sessionId, slot);
    });

    this.onMessage(CM.ToggleWeapon, (client, message: ToggleWeaponMessage) => {
      const player = this.state.players.get(client.sessionId);
      const rt = this.runtimes.get(client.sessionId);
      if (!player || !rt || !player.alive) return;
      // Legacy show/hide toggle summons the class DEFAULT weapon (atk 0) — its
      // durability tracks too, though breaking a starter stick costs nothing.
      const weaponId = message.equipped ? defaultWeaponForClass(player.classId as ClassId) : "";
      player.weaponId = weaponId;
      rt.weaponUses = weaponId ? itemMaxUses(weaponId) ?? -1 : -1;
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

    this.onMessage(CM.FishHere, (client, message: FishHereMessage) => {
      this.fishHere(client.sessionId, message?.x ?? 0, message?.z ?? 0);
    });

    this.onMessage(CM.Craft, (client, message: CraftMessage) => {
      this.craftRecipe(client.sessionId, message?.recipeId ?? "");
    });

    this.onMessage(CM.BuyItem, (client, message: BuyItemMessage) => {
      void this.buyItem(client.sessionId, message?.itemId ?? "");
    });

    this.onMessage(CM.SellItem, (client, message: SellItemMessage) => {
      void this.sellItem(client.sessionId, message?.index ?? -1);
    });

    this.onMessage(CM.StashDeposit, (client, message: StashDepositMessage) => {
      void this.stashDeposit(client, message?.index ?? -1);
    });

    this.onMessage(CM.StashWithdraw, (client, message: StashWithdrawMessage) => {
      void this.stashWithdraw(client, message?.itemId ?? "");
    });

    this.onMessage(CM.ClaimDaily, (client, message: ClaimDailyMessage) => {
      void this.claimDaily(client, message?.questId ?? "");
    });

    this.onMessage(CM.BuySkin, (client, message: BuySkinMessage) => {
      void this.buySkin(client, message?.skinId ?? "");
    });

    this.onMessage(CM.EquipSkin, (client, message: EquipSkinMessage) => {
      void this.equipSkin(client, message?.skinId ?? "");
    });

    this.onMessage(CM.Chat, (client, message: ChatMessage) => {
      this.handleChat(client, message?.text ?? "");
    });

    this.onMessage(CM.Spin, (client) => {
      void this.handleSpin(client);
    });

    this.onMessage(CM.RefreshPrivate, (client) => {
      void this.refreshPrivate(client);
    });

    this.setSimulationInterval((dt) => this.update(dt / 1000), TICK_MS);
  }

  override async onAuth(_client: Client, options: unknown): Promise<AuthData> {
    const opts = (options ?? {}) as { ticket?: string; classId?: ClassId; name?: string };
    const VALID_CLASSES: readonly ClassId[] = ["knight", "reaper", "cleric", "necromancer"];
    const classId: ClassId = opts.classId && VALID_CLASSES.includes(opts.classId) ? opts.classId : "knight";
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
    // point (ringSpawn below depends on the seeded playerSpawn). Only the
    // FIRST joiner's seed counts: later joiners arrive with their own run
    // seeds, and overwriting the shared state.seed here re-pointed every
    // client at a map the server was not simulating (invisible walls,
    // unreachable boss) — the dungeon is built exactly once, so the synced
    // seed must be frozen with it.
    if (auth.claims && !this.initialSpawnsDone) this.state.seed = auth.claims.seed;
    this.ensureSeeded();

    const profile = classProfile(auth.classId);
    const player = new PlayerState();
    player.id = client.sessionId;
    player.accountId = auth.claims?.accountId ?? "";
    player.characterId = auth.claims?.characterId ?? "";
    player.name = auth.name;
    player.classId = auth.classId;
    player.skinId = auth.claims?.skinId ?? "";
    player.weaponId = defaultWeaponForClass(auth.classId);
    // Per-class HP: the Knight is a sturdy tank, the Necromancer squishy.
    player.maxHp = profile.maxHp;
    player.hp = profile.maxHp;
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
      engaging: false,
      potionCooldown: 0,
      cooldowns: new Map(),
      gcdRemaining: 0,
      queuedSlot: -1,
      queuedAt: 0,
      shieldSeconds: 0,
      frostSeconds: 0,
      frostTick: 0,
      frostAura: { radius: 0, tick: 0.5, damage: 0, skillId: "" },
      bulwarkSeconds: 0,
      bulwarkValue: 0,
      ampSeconds: 0,
      ampValue: 0,
      respawnTimer: 0,
      weaponUses: itemMaxUses(defaultWeaponForClass(auth.classId)) ?? -1,
      profile,
      runId: auth.claims?.runId ?? null,
      characterId: auth.claims?.characterId ?? "",
      accountId: auth.claims?.accountId ?? "",
      localGold: auth.claims ? 0 : DEV_STARTING_GOLD,
      localStash: new Map(),
      marketBusy: false,
      spinBusy: false,
      lastChatAt: -100,
      dailyBuffer: new Map(),
      baseTotalXp: auth.claims?.totalXp ?? 0,
      earnedXp: 0,
      earnedCurrency: 0,
      ticketed: auth.claims !== null,
      // Starter kit: potions + free starter tools (Kintara pattern — tools wear
      // out, so the gift doesn't undermine the crafting treadmill).
      bag: [
        { itemId: "health_potion", count: 3 },
        { itemId: "rusty_pickaxe", count: 1, uses: itemMaxUses("rusty_pickaxe") },
        { itemId: "willow_rod", count: 1, uses: itemMaxUses("willow_rod") },
      ],
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
    // Initial private snapshots (targeted): stash, daily quests, skins, spin.
    void this.sendStash(client, runtime);
    void this.sendDailies(client, runtime);
    void this.sendSkins(client, runtime);
    void this.sendSpinner(client, runtime);

    const welcome: WelcomeMessage = {
      selfId: client.sessionId,
      runId: auth.claims?.runId ?? "",
      // The ROOM's frozen seed, not the joiner's own run seed — late joiners
      // must render the map the server is actually simulating.
      seed: this.state.seed,
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
    if (rt) this.flushDaily(rt); // persist any un-flushed quest progress
    // Leaving mid-duel is a draw: both stakes refund (no rage-quit scam,
    // no disconnect punishment). Must run BEFORE the runtime is deleted.
    const duel = this.duels.get(client.sessionId);
    if (duel) await this.resolveDuel(duel, null, "player left");
    this.pendingDuels.delete(client.sessionId);
    for (const enemy of this.enemies) enemy.removeThreat(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);

    if (rt?.ticketed && rt.runId) {
      // Economy v2: the coliseum tier is the run's progression axis (the wire
      // field keeps its legacy name until the rebrand rename).
      const tier = this.coliseumTier;
      await this.reporter.reportRunFinish(rt.runId, {
        outcome: "abandoned",
        depthReached: tier,
        xpEarned: Math.min(rt.earnedXp, maxXpForRun(tier)),
        currencyEarned: Math.min(rt.earnedCurrency, maxCurrencyForRun(tier)),
        loot: [],
      });
    }
  }

  private update(dt: number): void {
    this.tick++;
    this.elapsedSeconds += dt;
    this.movePlayers(dt);
    this.groundEntities();
    this.updateCooldowns(dt);
    this.updateWaves(dt);
    this.updateBossPortal(dt);
    this.updateColiseum(dt);

    const targets = this.buildTargetMap();
    this.updateEnemies(dt, targets);
    this.updateFrostAuras(dt);
    this.updateDots(dt);
    this.updatePlayerAttacks(dt);
    this.updatePendingImpacts(dt);
    this.updatePendingProjectiles(dt);
    this.updateActionStates();
    this.updateRespawns(dt);
    this.updateDeadEnemyDespawn(dt);
    this.updateNodeRespawns(dt);
    this.updateDailyFlush(dt);
    this.updateFountain(dt);
    this.updateDuels(dt);
  }

  /**
   * Town fountain: regen HP for any living player standing on the spawn pad.
   * A safe recovery spot so players don't have to burn potions between runs —
   * heals only, never while a player is out in the dungeon.
   */
  /** Stand every player and enemy on the terrain surface — the official map
   *  has ramps/reliefs, so y follows the ground grid (flat maps sample 0). */
  private groundEntities(): void {
    if (!this.dungeon.sampleHeight) return;
    this.state.players.forEach((p) => { p.y = groundHeightAt(p.x, p.z, this.dungeon); });
    this.state.enemies.forEach((e) => { e.y = groundHeightAt(e.x, e.z, this.dungeon); });
  }

  private updateFountain(dt: number): void {
    // Heal on the stone-circle centre (matches the client's visual ring), which
    // is a couple units off the raw spawn empty. Procedural map → spawn.
    const pad = this.dungeon.fountainPad ?? this.dungeon.playerSpawn;
    const heal = FOUNTAIN_HEAL_PER_SECOND * dt;
    this.state.players.forEach((p) => {
      if (!p.alive || p.hp >= p.maxHp) return;
      if (Math.hypot(p.x - pad.x, p.z - pad.z) > FOUNTAIN_RADIUS) return;
      p.hp = Math.min(p.maxHp, p.hp + heal);
    });
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
      rt.ampSeconds = Math.max(0, rt.ampSeconds - dt);
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
      // Keep the HUD swing bar accurate as weapons (and their speed) change.
      p.swingInterval = swingIntervalFor(rt.profile, p.weaponId);
      p.shieldSeconds = rt.shieldSeconds;
      p.frostSeconds = rt.frostSeconds;
      p.ampSeconds = rt.ampSeconds;
      // Mirror per-skill cooldowns + level unlocks into the synced hotbar.
      for (const slot of p.hotbar) {
        if (!slot.skillId) continue;
        slot.cooldownRemaining = rt.cooldowns.get(slot.skillId) ?? 0;
        const def = skillDef(slot.skillId);
        slot.unlocked = !!def && def.learnLevel <= p.level;
      }
      // Fire a buffered skill press the instant its gate has cleared.
      this.tryFireQueued(id, rt);
    });
  }

  /** Cast a buffered skill press once it becomes castable, or expire it. */
  private tryFireQueued(playerId: string, rt: PlayerRuntime): void {
    if (rt.queuedSlot < 0) return;
    if (this.elapsedSeconds - rt.queuedAt > INPUT_BUFFER_SECONDS) {
      rt.queuedSlot = -1;
      return;
    }
    const p = this.state.players.get(playerId);
    const slot = p?.hotbar[rt.queuedSlot];
    const def = slot?.skillId ? skillDef(slot.skillId) : undefined;
    if (!p || !p.alive || !def) {
      rt.queuedSlot = -1;
      return;
    }
    // Still gated? Keep it queued until it opens or the window lapses.
    if ((!def.offGcd && rt.gcdRemaining > 0) || (rt.cooldowns.get(def.id) ?? 0) > 0) return;
    const slotIndex = rt.queuedSlot;
    rt.queuedSlot = -1; // clear BEFORE casting so a re-buffer can't loop
    this.castSkillSlot(playerId, slotIndex);
  }

  private updateWaves(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    // Intensity ramps over the first ~5 minutes: waves come faster, elites more
    // often, more enemies allowed alive, and periodic swarmer packs punctuate.
    const intensity = Math.min(1, this.elapsedSeconds / 300);
    this.waveTimer = WAVE_INTERVAL_SECONDS * (1 - 0.45 * intensity);
    const cap = MAX_LIVE_ENEMIES + Math.floor(4 * intensity);
    if (this.liveEnemyCount() >= cap) return;

    this.waveCount++;
    const areas = this.dungeon.areas;
    // Official map: repopulate a RANDOM area with ITS OWN roster (keeps each
    // area's theme + band); procedural map: the flat uniform trickle.
    if (areas?.length) {
      const area = areas[Math.floor(Math.random() * areas.length)]!;
      const roster = AREA_ROSTERS[area.id - 1]!;
      if (this.waveCount % 4 === 0 && intensity > 0.2) {
        // A pack of this area's minions.
        const pt = area.normalSpawns[Math.floor(Math.random() * area.normalSpawns.length)] ?? area.center;
        const packSize = 3 + Math.floor(intensity * 2);
        for (let i = 0; i < packSize; i++) this.spawnEnemy(roster.minion, pt.x + (i - 2) * 1.1, pt.z + (i % 2) * 1.1);
        return;
      }
      const isElite = Math.random() < ELITE_CHANCE + 0.15 * intensity;
      const pts = isElite ? area.eliteSpawns : area.normalSpawns;
      const pt = pts[Math.floor(Math.random() * pts.length)] ?? area.center;
      this.spawnEnemy(isElite ? roster.elite : roster.minion, pt.x, pt.z);
      return;
    }

    // Every 4th wave (once things heat up) is a swarmer pack — a punctuated
    // "oh no, a group" moment instead of the endless one-at-a-time trickle.
    if (this.waveCount % 4 === 0 && intensity > 0.2) {
      const point = this.randomSpawnPoint(SWARMER);
      const packSize = 3 + Math.floor(intensity * 2); // 3-5
      for (let i = 0; i < packSize; i++) {
        this.spawnEnemy(SWARMER, point.x + (i - 2) * 1.1, point.z + (i % 2) * 1.1);
      }
      return;
    }

    const roll = Math.random();
    const def = roll < ELITE_CHANCE + 0.15 * intensity ? ELITE_GRUNT : roll < 0.6 ? SWARMER : GRUNT;
    const point = this.randomSpawnPoint(def);
    this.spawnEnemy(def, point.x, point.z);
  }

  /** Re-form the Coliseum world boss a bit after it's slain, one tier stronger. */
  /** Tiers up to this respawn free; beyond it the champion demands a Trial Key
   *  (Economy v2 content-as-consumable — forged from champion materials). */
  private static readonly COLISEUM_FREE_TIERS = 5;
  private coliseumAwaitingKey = false;

  // --- PvP wagered duels (Phase B): /duel <stake> while targeting a player,
  // /accept, /forfeit. Both stakes escrow on accept; winner takes 90%, 10% is
  // BURNED (debited at escrow, never re-credited — a pure combat gold sink).
  // Timeout or either player leaving refunds both stakes.
  private static readonly DUEL_MIN_STAKE = 10;
  private static readonly DUEL_MAX_STAKE = 2000;
  private static readonly DUEL_SECONDS = 120;
  private static readonly DUEL_WINNER_SHARE = 0.9;
  /** Active duels, one entry per PARTICIPANT id (both point at the same object). */
  private duels = new Map<string, { a: string; b: string; stake: number; timeLeft: number }>();
  /** Pending challenges keyed by the CHALLENGED player's id. */
  private pendingDuels = new Map<string, { from: string; stake: number; expiresAt: number }>();

  private updateColiseum(dt: number): void {
    const c = this.dungeon.coliseumPortal;
    if (!c) return;

    if (this.coliseumRespawnTimer > 0) {
      this.coliseumRespawnTimer -= dt;
      if (this.coliseumRespawnTimer <= 0) {
        if (this.coliseumTier <= ZoneRoom.COLISEUM_FREE_TIERS) {
          this.spawnEnemy(coliseumBossForTier(this.coliseumTier), c.x, c.z);
        } else if (!this.coliseumAwaitingKey) {
          this.coliseumAwaitingKey = true;
          this.broadcast(ServerMessage.Chat, {
            text: `Tier ${this.coliseumTier} champion awaits a TRIAL KEY — forge one and bring it to the arena.`,
            from: "⚔ Coliseum",
          } as ChatMessage);
        }
      }
      return;
    }

    // Key gate: any living player standing in the arena with a trial_key
    // consumes one and summons the champion for everyone.
    if (!this.coliseumAwaitingKey) return;
    for (const [playerId, rt] of this.runtimes) {
      const p = this.state.players.get(playerId);
      if (!p || !p.alive) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) > 8) continue;
      if (!removeStacked(rt.bag, "trial_key", 1)) continue;
      this.syncBag(p, rt);
      this.coliseumAwaitingKey = false;
      this.spawnEnemy(coliseumBossForTier(this.coliseumTier), c.x, c.z);
      this.broadcast(ServerMessage.Chat, {
        text: `${p.name} spent a Trial Key — the Tier ${this.coliseumTier} champion rises!`,
        from: "⚔ Coliseum",
      } as ChatMessage);
      break;
    }
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
      if (action.special) this.enemySpecialSlam(enemy);
      else if (action.attackTargetId) this.enemyHitsPlayer(enemy, action.attackTargetId);
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
        this.damageEnemy(id, rt, p, enemy, rt.frostAura.damage, "skill", this.nextActionId(), rt.frostAura.skillId);
      }
    });
  }

  /**
   * Tick Necromancer curses (single-target DoTs). Each due tick is routed
   * through damageEnemy so it builds threat, awards the kill, and rolls loot
   * exactly like a direct hit — the caster keeps the credit even at range.
   */
  private updateDots(dt: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.state.alive) continue;
      const ticks = enemy.advanceDots(dt);
      for (const t of ticks) {
        const source = this.state.players.get(t.sourceId);
        const rt = this.runtimes.get(t.sourceId);
        // Source disconnected or died: the curse fizzles this tick (drops next).
        if (!source || !rt || !source.alive) continue;
        if (!enemy.state.alive) break;
        this.damageEnemy(t.sourceId, rt, source, enemy, t.damage, "skill", this.nextActionId(), t.skillId);
      }
    }
  }

  private updatePlayerAttacks(dt: number): void {
    this.runtimes.forEach((rt, id) => {
      const p = this.state.players.get(id);
      if (!p || !p.alive) return;
      rt.attackCooldown = Math.max(0, rt.attackCooldown - dt);
      if (!p.autoAttack || !p.targetId || rt.attackCooldown > 0) return;

      // PvP: swinging at your DUEL OPPONENT uses the pvp path; any other player
      // target is ignored (players are never attackable outside a duel).
      const duel = this.duels.get(id);
      if (duel && p.targetId === (duel.a === id ? duel.b : duel.a)) {
        this.duelSwing(id, rt, p, p.targetId);
        return;
      }

      const enemy = this.enemies.find((e) => e.state.id === p.targetId);
      if (!enemy || !enemy.state.alive) {
        p.targetId = "";
        p.autoAttack = false;
        return;
      }
      const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
      const range = attackRangeFor(rt.profile, p.weaponId);
      if (d > range) {
        // Out of range: only chase if the player engaged by clicking the target
        // and isn't steering themselves this tick. Manual movement wins, so
        // strafing/kiting away is never yanked back to the target.
        const manualMove = Math.hypot(rt.input.moveX, rt.input.moveZ) > 0.01;
        if (rt.engaging && !manualMove) this.autoFollowTarget(p, enemy, dt, range);
        return;
      }

      this.facePlayerToEnemy(p, enemy);
      rt.attackCooldown = swingIntervalFor(rt.profile, p.weaponId);
      const actionId = this.nextActionId();
      this.setAction(p, "attack", actionDuration(DEFAULT_MELEE_ATTACK_TIMING), enemy.state.id, actionId);

      if (rt.profile.ranged) {
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
            const isCrit = Math.random() < critChanceFor(liveSource.weaponId);
            const dmg = resolveDamage(basicAttackRaw(liveSource, rtNow), liveTarget.def.armor, liveSource.level, isCrit);
            this.damageEnemy(id, rtNow, liveSource, liveTarget, dmg, isCrit ? "crit" : "hit", actionId, "basic_attack");
          }, "basic_attack");
        });
      } else {
        this.scheduleImpact(actionId, DEFAULT_MELEE_ATTACK_TIMING.windup, () => {
          const source = this.state.players.get(id);
          const target = this.enemies.find((e) => e.state.id === enemy.state.id);
          const liveRt = this.runtimes.get(id);
          if (!source || !liveRt || !source.alive || !target?.state.alive || !this.isCurrentAction(source, actionId)) return;
          const liveDistance = Math.hypot(target.state.x - source.x, target.state.z - source.z);
          if (liveDistance > attackRangeFor(liveRt.profile, source.weaponId) + 0.75) {
            // Target juked out during the windup — refund most of the swing so
            // re-engaging is snappy instead of a full-interval lockout on a whiff.
            liveRt.attackCooldown = Math.min(liveRt.attackCooldown, DEFAULT_MELEE_ATTACK_TIMING.windup);
            return;
          }
          this.facePlayerToEnemy(source, target);
          const isCrit = Math.random() < critChanceFor(source.weaponId);
          const dmg = resolveDamage(basicAttackRaw(source, liveRt), target.def.armor, source.level, isCrit);
          this.damageEnemy(id, liveRt, source, target, dmg, isCrit ? "crit" : "hit", actionId, "basic_attack");
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
      slot.uses = src?.uses ?? -1;
    }
    while (inv.length > BAG_CAPACITY) inv.pop();
  }

  /** Equip a weapon from the bag; the previously equipped weapon returns to the
   *  bag. Durability travels with the item: the slot's remaining uses move to
   *  rt.weaponUses on equip and back onto the bag slot on unequip. */
  private equipWeaponFromBag(playerId: string, itemId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    if (!canEquipWeapon(p.classId as ItemClassId, itemId)) return;
    const slotIndex = rt.bag.findIndex((s) => s.itemId === itemId);
    if (slotIndex === -1) return;
    const incomingUses = rt.bag[slotIndex]!.uses ?? itemMaxUses(itemId) ?? -1;
    if (!removeAt(rt.bag, slotIndex, 1)) return;
    const previous = p.weaponId;
    const previousUses = rt.weaponUses;
    p.weaponId = itemId;
    rt.weaponUses = incomingUses;
    if (previous && itemDef(previous)?.kind === "weapon") {
      addStacked(rt.bag, BAG_CAPACITY, previous, 1, previousUses > 0 ? previousUses : undefined);
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
  /** Economy v2: gathering requires a working tool in the bag. Returns its bag
   *  index, or -1 (after telling the player what they're missing). */
  private requireTool(playerId: string, toolKind: "mining" | "fishing"): number {
    const rt = this.runtimes.get(playerId);
    if (!rt) return -1;
    const idx = findToolIndex(rt.bag, toolKind, (id) => itemDef(id)?.toolKind);
    if (idx === -1) {
      const label = toolKind === "mining" ? "pickaxe" : "fishing rod";
      this.clients
        .find((c) => c.sessionId === playerId)
        ?.send(ServerMessage.Chat, { text: `You need a ${label} — the Market sells starter tools.`, from: "⚒" } as ChatMessage);
    }
    return idx;
  }

  /** Spend one tool use at gather impact; announce a break. */
  private spendToolUse(playerId: string, rt: PlayerRuntime, toolKind: "mining" | "fishing"): void {
    const idx = findToolIndex(rt.bag, toolKind, (id) => itemDef(id)?.toolKind);
    if (idx === -1) return;
    const itemId = rt.bag[idx]!.itemId;
    if (spendUse(rt.bag, idx) === "broke") {
      const def = itemDef(itemId);
      this.clients
        .find((c) => c.sessionId === playerId)
        ?.send(ServerMessage.Chat, { text: `Your ${def?.name ?? "tool"} broke!`, from: "⚒" } as ChatMessage);
    }
  }

  private gatherNode(playerId: string, nodeId: string): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    const node = this.state.nodes.get(nodeId);
    if (!rt || !p || !p.alive || !node || node.depleted) return;
    if (Math.hypot(node.x - p.x, node.z - p.z) > GATHER_RANGE) return;

    const isFishing = node.kind === "fishing_spot" || node.kind === "deep_fishing_spot";
    if (this.requireTool(playerId, isFishing ? "fishing" : "mining") === -1) return;
    const castSeconds = isFishing ? FISH_CAST_SECONDS : GATHER_CAST_SECONDS;
    const actionId = this.nextActionId();
    // Action window outlives the impact tick — an impact scheduled exactly at
    // the action's end loses the isCurrentAction race by one frame.
    this.setAction(p, "skill", castSeconds + 0.4, nodeId, actionId);
    this.scheduleImpact(actionId, castSeconds, () => {
      const source = this.state.players.get(playerId);
      const liveRt = this.runtimes.get(playerId);
      const liveNode = this.state.nodes.get(nodeId);
      if (!source || !liveRt || !source.alive || !liveNode || liveNode.depleted) return;
      if (!this.isCurrentAction(source, actionId)) return;
      if (Math.hypot(liveNode.x - source.x, liveNode.z - source.z) > GATHER_RANGE + 0.75) return;

      // Yields per node kind. Mining: iron veins give 1-2 ore, crystal veins a
      // shard + 25% ore. Fishing: shallow spots give minnows (40% bonus cavefish),
      // deep spots give cavefish (25% rare bass).
      const grants: { itemId: string; count: number }[] = [];
      if (liveNode.kind === "crystal_vein") {
        grants.push({ itemId: "crystal_shard", count: 1 });
        if (Math.random() < 0.25) grants.push({ itemId: "iron_ore", count: 1 });
      } else if (liveNode.kind === "fishing_spot") {
        grants.push({ itemId: "raw_minnow", count: 1 });
        if (Math.random() < 0.4) grants.push({ itemId: "raw_cavefish", count: 1 });
      } else if (liveNode.kind === "deep_fishing_spot") {
        grants.push({ itemId: "raw_cavefish", count: 1 });
        if (Math.random() < 0.25) grants.push({ itemId: "raw_gilded_bass", count: 1 });
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
          this.bumpDaily(liveRt, "gather", grant.itemId, deposited);
        }
      }
      this.spendToolUse(playerId, liveRt, isFishing ? "fishing" : "mining");
      this.syncBag(source, liveRt);
      liveNode.depleted = true;
      this.nodeRespawns.set(nodeId, NODE_RESPAWN_SECONDS);
    });
  }

  /** Fish the open water on the island map. No node: the client sends a water
   *  point; the server checks the player is on land, the point is water
   *  (not walkable) within reach and adjacent to shore, then runs the fishing
   *  cast. Deeper water (farther from land) yields better fish. */
  private fishHere(playerId: string, x: number, z: number): void {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    // Point must be WATER (off the walkable land) and within a short reach.
    if (isDungeonWalkable(x, z, 0.3, this.dungeon)) return;
    if (Math.hypot(x - p.x, z - p.z) > GATHER_RANGE) return;
    // ...and near the shore: some land within ~5u of the target (no fishing
    // in the deep middle of the ocean, only off the island's edge).
    const shore = nearestDungeonWalkablePoint(x, z, 0.3, this.dungeon);
    const distToShore = Math.hypot(shore.x - x, shore.z - z);
    if (distToShore > 6) return;
    if (this.requireTool(playerId, "fishing") === -1) return;

    const actionId = this.nextActionId();
    this.facePlayerToPoint(p, x, z);
    this.setAction(p, "skill", FISH_CAST_SECONDS + 0.4, playerId, actionId);
    this.scheduleImpact(actionId, FISH_CAST_SECONDS, () => {
      const source = this.state.players.get(playerId);
      const liveRt = this.runtimes.get(playerId);
      if (!source || !liveRt || !source.alive || !this.isCurrentAction(source, actionId)) return;
      // Deeper water (>3u from shore) fishes like the old deep spot.
      const deep = distToShore > 3;
      const grants: { itemId: string; count: number }[] = deep
        ? [{ itemId: "raw_cavefish", count: 1 }, ...(Math.random() < 0.25 ? [{ itemId: "raw_gilded_bass", count: 1 }] : [])]
        : [{ itemId: "raw_minnow", count: 1 }, ...(Math.random() < 0.4 ? [{ itemId: "raw_cavefish", count: 1 }] : [])];
      if (!this.bagHasRoomFor(liveRt.bag, grants[0]!.itemId)) return;
      for (const grant of grants) {
        const leftover = addStacked(liveRt.bag, BAG_CAPACITY, grant.itemId, grant.count);
        const deposited = grant.count - leftover;
        if (deposited > 0) {
          const def = itemDef(grant.itemId);
          this.broadcast(ServerMessage.LootEvent, { playerId: source.id, itemId: grant.itemId, rarity: def?.rarity ?? "" } as LootEventMessage);
          this.bumpDaily(liveRt, "gather", grant.itemId, deposited);
        }
      }
      this.spendToolUse(playerId, liveRt, "fishing");
      this.syncBag(source, liveRt);
    });
  }

  private facePlayerToPoint(p: PlayerState, x: number, z: number): void {
    const dx = x - p.x, dz = z - p.z;
    if (Math.hypot(dx, dz) > 1e-3) p.yaw = Math.atan2(dx, dz);
  }

  /** True when the player stands at the market stall. */
  private nearMarket(p: PlayerState): boolean {
    const stall = this.dungeon.marketStall;
    return Math.hypot(stall.x - p.x, stall.z - p.z) <= MARKET_RANGE;
  }

  /** True when the player stands at the cooking station. */
  private nearCookingStation(p: PlayerState): boolean {
    const s = this.dungeon.cookingStation;
    return Math.hypot(s.x - p.x, s.z - p.z) <= COOK_RANGE;
  }

  /**
   * Cook a recipe at the station: consume raw ingredients from the bag, grant
   * the cooked food. Pure synchronous bag math (no wallet, no backend) — the
   * useBagItem guard ladder + gatherNode's grant path, range-gated like buyItem.
   */
  private craftRecipe(playerId: string, recipeId: string): void {
    // Forge recipes (and the repair sentinel) route to the async forge path;
    // everything else is a cooking recipe at the bakery.
    if (recipeId === REPAIR_WEAPON_ID || forgeRecipe(recipeId)) {
      void this.craftForge(playerId, recipeId);
      return;
    }
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive) return;
    if (!this.nearCookingStation(p)) return;
    const recipe = cookingRecipe(recipeId);
    if (!recipe) return;
    // Must have every ingredient and room for the output.
    for (const input of recipe.inputs) {
      if (countItem(rt.bag, input.itemId) < input.count) return;
    }
    if (!this.bagHasRoomFor(rt.bag, recipe.output)) return;
    // Consume, then grant (ingredients confirmed present, so removes succeed).
    for (const input of recipe.inputs) {
      if (!removeStacked(rt.bag, input.itemId, input.count)) return;
    }
    addStacked(rt.bag, BAG_CAPACITY, recipe.output, recipe.outputCount);
    this.syncBag(p, rt);
    const def = itemDef(recipe.output);
    const loot: LootEventMessage = { playerId: p.id, itemId: recipe.output, rarity: def?.rarity ?? "" };
    this.broadcast(ServerMessage.LootEvent, loot);
    this.bumpDaily(rt, "cook", recipe.output, recipe.outputCount);
  }

  /** True when the player stands at the forge. */
  private nearForge(p: PlayerState): boolean {
    const f = this.dungeon.forge ?? this.dungeon.marketStall;
    return Math.hypot(f.x - p.x, f.z - p.z) <= COOK_RANGE;
  }

  /**
   * Forge execution: craft recipes (materials + a GOLD FEE) and the
   * repair-equipped-weapon sentinel. Gold moves through the same wallet path
   * as market buys, so the fee is a real sink; materials burn from the bag.
   */
  private async craftForge(playerId: string, recipeId: string): Promise<void> {
    const rt = this.runtimes.get(playerId);
    const p = this.state.players.get(playerId);
    if (!rt || !p || !p.alive || rt.marketBusy) return;
    if (!this.nearForge(p)) return;

    if (recipeId === REPAIR_WEAPON_ID) {
      const weaponId = p.weaponId;
      const max = weaponId ? itemMaxUses(weaponId) : undefined;
      if (!weaponId || max === undefined || rt.weaponUses >= max) return;
      const cost = repairCost(weaponId) ?? 5;
      rt.marketBusy = true;
      try {
        const balance = await this.moveGold(rt, -cost, "forge_repair");
        if (balance === null) return;
        rt.weaponUses = max;
        p.gold = balance;
        this.clients.find((c) => c.sessionId === playerId)?.send(ServerMessage.Chat, { text: `Repaired your ${itemDef(weaponId)?.name ?? "weapon"} (−${cost}g).`, from: "⚒" } as ChatMessage);
      } finally {
        rt.marketBusy = false;
      }
      return;
    }

    const recipe = forgeRecipe(recipeId);
    if (!recipe) return;
    for (const input of recipe.inputs) {
      if (countItem(rt.bag, input.itemId) < input.count) return;
    }
    if (!this.bagHasRoomFor(rt.bag, recipe.output)) return;
    rt.marketBusy = true;
    try {
      const balance = await this.moveGold(rt, -recipe.goldCost, "forge_craft");
      if (balance === null) return; // can't afford the fee
      for (const input of recipe.inputs) {
        if (!removeStacked(rt.bag, input.itemId, input.count)) return;
      }
      addStacked(rt.bag, BAG_CAPACITY, recipe.output, recipe.outputCount);
      p.gold = balance;
      this.syncBag(p, rt);
      const def = itemDef(recipe.output);
      this.broadcast(ServerMessage.LootEvent, { playerId: p.id, itemId: recipe.output, rarity: def?.rarity ?? "" } as LootEventMessage);
    } finally {
      rt.marketBusy = false;
    }
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

  // --- Daily quests (gold faucet; backend-persisted for ticketed accounts) ---

  private dailyFlushAccum = 0;

  /** Today's active quest defs (UTC). Uses wall-clock — fine, this is the room. */
  private todaysDailyDefs() {
    return dailyQuestsFor(dateKeyUTC(new Date()));
  }

  /** Buffer progress for any of today's quests matching this game event. */
  private bumpDaily(rt: PlayerRuntime, kind: DailyQuestKind, subject: string, amount: number): void {
    if (!rt.accountId || amount <= 0) return;
    for (const def of this.todaysDailyDefs()) {
      if (def.kind !== kind) continue;
      if (def.subject !== "" && def.subject !== subject) continue;
      rt.dailyBuffer.set(def.id, (rt.dailyBuffer.get(def.id) ?? 0) + amount);
    }
  }

  /** Flush one player's buffered daily progress to the backend (fire-and-forget). */
  private flushDaily(rt: PlayerRuntime): void {
    if (!rt.accountId || rt.dailyBuffer.size === 0) return;
    const pending = [...rt.dailyBuffer.entries()];
    rt.dailyBuffer.clear();
    for (const [questId, delta] of pending) {
      void this.reporter.dailyProgress(rt.accountId, questId, delta);
    }
  }

  private updateDailyFlush(dt: number): void {
    this.dailyFlushAccum += dt;
    if (this.dailyFlushAccum < 10) return;
    this.dailyFlushAccum = 0;
    this.runtimes.forEach((rt, id) => {
      const before = rt.dailyBuffer.size;
      this.flushDaily(rt);
      // After flushing, push a fresh snapshot so the client's tracker updates.
      if (before > 0) {
        const client = this.clients.find((c) => c.sessionId === id);
        if (client) void this.sendDailies(client, rt);
      }
    });
  }

  /** Send the player their OWN daily quests + progress (targeted). */
  private async sendDailies(client: Client, rt: PlayerRuntime): Promise<void> {
    if (!rt.accountId) {
      // Ticketless dev join: show today's quests with zero progress, un-claimable.
      const payload: DailiesMessage = {
        dateKey: dateKeyUTC(new Date()),
        quests: this.todaysDailyDefs().map((d) => ({ ...d, progress: 0, claimed: false })),
      };
      client.send(ServerMessage.Dailies, payload);
      return;
    }
    const res = await this.reporter.dailiesList(rt.accountId);
    const body = res.json as DailiesMessage | null;
    if (res.ok && body) client.send(ServerMessage.Dailies, body);
  }

  /** Claim a completed daily: credit gold, bump the live run's XP, toast. */
  private async claimDaily(client: Client, questId: string): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt || !p || !rt.accountId) return;
    this.flushDaily(rt); // make sure just-earned progress is counted first
    const res = await this.reporter.dailyClaim(rt.accountId, questId);
    if (!res.ok) return;
    const live = this.state.players.get(client.sessionId);
    if (live && res.balance !== undefined) live.gold = res.balance;
    if (live && res.xp) {
      rt.earnedXp += res.xp;
      live.runXp += res.xp;
      live.level = levelForTotalXp(rt.baseTotalXp + live.runXp);
      this.emitCombat({ sourceId: live.id, targetId: live.id, amount: -(res.gold ?? 0), kind: "heal", actionId: this.nextActionId() });
    }
    await this.sendDailies(client, rt);
  }

  // --- Cosmetic skins (gold sink; ownership + equip persisted per character) ---

  /** Send the player their OWN owned + equipped skins (targeted). */
  private async sendSkins(client: Client, rt: PlayerRuntime): Promise<void> {
    if (!rt.characterId) {
      client.send(ServerMessage.Skins, { equipped: "", owned: [] } as SkinsMessage);
      return;
    }
    const res = await this.reporter.skinsList(rt.characterId);
    const payload: SkinsMessage = { equipped: res.equipped ?? "", owned: res.owned ?? [] };
    client.send(ServerMessage.Skins, payload);
  }

  private async buySkin(client: Client, skinId: string): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt || !p || !p.alive || rt.marketBusy || !rt.characterId) return;
    if (!this.nearMarket(p)) return;
    if (!skinDef(skinId)) return;
    rt.marketBusy = true;
    try {
      const res = await this.reporter.skinBuy(rt.characterId, skinId);
      const live = this.state.players.get(client.sessionId);
      if (res.ok && live && res.balance !== undefined) live.gold = res.balance;
      await this.sendSkins(client, rt);
    } finally {
      rt.marketBusy = false;
    }
  }

  private async equipSkin(client: Client, skinId: string): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt || !p || !p.alive || rt.marketBusy || !rt.characterId) return;
    if (skinId !== "" && !skinDef(skinId)) return;
    rt.marketBusy = true;
    try {
      const res = await this.reporter.skinEquip(rt.characterId, skinId);
      const live = this.state.players.get(client.sessionId);
      if (res.ok && live) live.skinId = skinId; // synced -> all clients re-render the model
      await this.sendSkins(client, rt);
    } finally {
      rt.marketBusy = false;
    }
  }

  /** Send the player their OWN stash contents (targeted — stash is private). */
  private async sendStash(client: Client, rt: PlayerRuntime): Promise<void> {
    let items: { itemId: string; count: number }[];
    if (rt.accountId) {
      const res = await this.reporter.stashList(rt.accountId);
      items = res.ok && res.items ? res.items : [];
    } else {
      items = [...rt.localStash.entries()].map(([itemId, count]) => ({ itemId, count }));
    }
    const payload: StashMessage = { items, slotCap: STASH_SLOT_CAP };
    client.send(ServerMessage.Stash, payload);
  }

  /** Dev-local stash mutation mirroring the backend's caps. */
  private localStashDeposit(rt: PlayerRuntime, itemId: string): boolean {
    const have = rt.localStash.get(itemId) ?? 0;
    if (have === 0 && rt.localStash.size >= STASH_SLOT_CAP) return false;
    if (have + 1 > STASH_STACK_CAP) return false;
    rt.localStash.set(itemId, have + 1);
    return true;
  }

  private localStashWithdraw(rt: PlayerRuntime, itemId: string): boolean {
    const have = rt.localStash.get(itemId) ?? 0;
    if (have <= 0) return false;
    if (have === 1) rt.localStash.delete(itemId);
    else rt.localStash.set(itemId, have - 1);
    return true;
  }

  /** Move one unit bag -> stash (at the stall). Remove-first, restore on failure. */
  private async stashDeposit(client: Client, index: number): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt || !p || !p.alive || rt.marketBusy) return;
    if (!this.nearMarket(p)) return;
    const slot = rt.bag[index];
    if (!slot || slot.count <= 0 || !itemDef(slot.itemId)) return;
    // Economy v2: the stash (and therefore the P2P market, which lists FROM the
    // stash) only carries PRISTINE durability items — worn tools/weapons must
    // be repaired first. Keeps stash/market rows free of per-instance state.
    const pristineMax = itemMaxUses(slot.itemId);
    if (pristineMax !== undefined && (slot.uses ?? pristineMax) < pristineMax) {
      client.send(ServerMessage.Chat, { text: "Worn gear can't be banked — repair it first.", from: "⚒" } as ChatMessage);
      return;
    }

    rt.marketBusy = true;
    try {
      const itemId = slot.itemId;
      if (!removeAt(rt.bag, index, 1)) return;
      const ok = rt.accountId
        ? (await this.reporter.stashDeposit(rt.accountId, itemId, 1)).ok
        : this.localStashDeposit(rt, itemId);
      if (!ok) addStacked(rt.bag, BAG_CAPACITY, itemId, 1); // stash full / backend down
      this.syncBag(p, rt);
      await this.sendStash(client, rt);
    } finally {
      rt.marketBusy = false;
    }
  }

  /** Move one unit stash -> bag (at the stall). Bag room checked before the call. */
  private async stashWithdraw(client: Client, itemId: string): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt || !p || !p.alive || rt.marketBusy) return;
    if (!this.nearMarket(p)) return;
    if (!itemDef(itemId)) return;
    if (!this.bagHasRoomFor(rt.bag, itemId)) return;

    rt.marketBusy = true;
    try {
      const ok = rt.accountId
        ? (await this.reporter.stashWithdraw(rt.accountId, itemId, 1)).ok
        : this.localStashWithdraw(rt, itemId);
      if (ok) {
        const leftover = addStacked(rt.bag, BAG_CAPACITY, itemId, 1);
        if (leftover > 0) {
          // Bag filled during the await — put it back in the stash.
          if (rt.accountId) await this.reporter.stashDeposit(rt.accountId, itemId, 1);
          else this.localStashDeposit(rt, itemId);
        }
        this.syncBag(p, rt);
      }
      await this.sendStash(client, rt);
    } finally {
      rt.marketBusy = false;
    }
  }

  // --- Town social: world chat, free spinner, private re-sync ---

  private static readonly CHAT_MIN_INTERVAL = 1.0;
  private static readonly CHAT_MAX_LEN = 200;

  /** Broadcast a world-chat line, rate-limited and length-capped server-side. */
  private handleChat(client: Client, rawText: string): void {
    const rt = this.runtimes.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt || !p) return;
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, ZoneRoom.CHAT_MAX_LEN);
    if (!text) return;
    if (this.elapsedSeconds - rt.lastChatAt < ZoneRoom.CHAT_MIN_INTERVAL) return;
    rt.lastChatAt = this.elapsedSeconds;
    // Slash commands are intercepted, never broadcast.
    if (text.startsWith("/")) {
      this.handleChatCommand(client, rt, p, text);
      return;
    }
    const payload: ChatMessage = { text, from: p.name };
    this.broadcast(ServerMessage.Chat, payload);
  }

  private tell(playerId: string, text: string): void {
    this.clients.find((c) => c.sessionId === playerId)?.send(ServerMessage.Chat, { text, from: "⚔ Duel" } as ChatMessage);
  }

  /** /duel <stake> (targeting a player) · /accept · /forfeit */
  private handleChatCommand(client: Client, rt: PlayerRuntime, p: PlayerState, text: string): void {
    const parts = text.split(" ");
    const cmd = parts[0];
    if (cmd === "/duel") {
      // /duel <playerName> <stake>
      const name = (parts[1] ?? "").toLowerCase();
      const stake = Math.floor(Number(parts[2]));
      if (!name || !Number.isFinite(stake) || stake < ZoneRoom.DUEL_MIN_STAKE || stake > ZoneRoom.DUEL_MAX_STAKE) {
        this.tell(p.id, `Usage: /duel <player> <stake ${ZoneRoom.DUEL_MIN_STAKE}-${ZoneRoom.DUEL_MAX_STAKE}>`);
        return;
      }
      let target: PlayerState | undefined;
      this.state.players.forEach((cand) => {
        if (cand.name.toLowerCase() === name) target = cand;
      });
      if (!target || target.id === p.id || !target.alive) {
        this.tell(p.id, `No living player named "${parts[1]}" here.`);
        return;
      }
      if (this.duels.has(p.id) || this.duels.has(target.id)) {
        this.tell(p.id, "One of you is already dueling.");
        return;
      }
      this.pendingDuels.set(target.id, { from: p.id, stake, expiresAt: this.elapsedSeconds + 60 });
      this.broadcast(ServerMessage.Chat, {
        text: `${p.name} challenges ${target.name} to a DUEL for 🪙${stake} each — winner takes 90%, 10% burns. ${target.name}: type /accept`,
        from: "⚔ Duel",
      } as ChatMessage);
      return;
    }
    if (cmd === "/accept") {
      void this.acceptDuel(p.id);
      return;
    }
    if (cmd === "/forfeit") {
      const duel = this.duels.get(p.id);
      if (!duel) {
        this.tell(p.id, "You're not in a duel.");
        return;
      }
      void this.resolveDuel(duel, duel.a === p.id ? duel.b : duel.a, "forfeit");
      return;
    }
    this.tell(p.id, "Commands: /duel <stake> · /accept · /forfeit");
  }

  /** Escrow both stakes and start the duel (async: wallet debits). */
  private async acceptDuel(accepterId: string): Promise<void> {
    const pending = this.pendingDuels.get(accepterId);
    if (!pending || this.elapsedSeconds > pending.expiresAt) {
      this.tell(accepterId, "No open challenge (it may have expired).");
      return;
    }
    this.pendingDuels.delete(accepterId);
    const a = this.state.players.get(pending.from);
    const b = this.state.players.get(accepterId);
    const rtA = this.runtimes.get(pending.from);
    const rtB = this.runtimes.get(accepterId);
    if (!a || !b || !rtA || !rtB || !a.alive || !b.alive) return;
    if (this.duels.has(a.id) || this.duels.has(b.id)) return;

    // Escrow: debit both. If B fails after A was debited, refund A — money can
    // never be created or lost here except the intentional win-burn.
    const balA = await this.moveGold(rtA, -pending.stake, "duel_stake");
    if (balA === null) {
      this.tell(a.id, "Duel cancelled — challenger can't cover the stake.");
      this.tell(b.id, "Duel cancelled — challenger can't cover the stake.");
      return;
    }
    a.gold = balA;
    const balB = await this.moveGold(rtB, -pending.stake, "duel_stake");
    if (balB === null) {
      const refund = await this.moveGold(rtA, pending.stake, "duel_refund");
      if (refund !== null) a.gold = refund;
      this.tell(a.id, "Duel cancelled — opponent can't cover the stake.");
      this.tell(b.id, "Duel cancelled — you can't cover the stake.");
      return;
    }
    b.gold = balB;

    const duel = { a: a.id, b: b.id, stake: pending.stake, timeLeft: ZoneRoom.DUEL_SECONDS };
    this.duels.set(a.id, duel);
    this.duels.set(b.id, duel);
    // Auto-engage both (player models aren't click-targetable): each targets
    // the other with auto-attack on — the fight starts the moment they close.
    a.targetId = b.id;
    b.targetId = a.id;
    a.autoAttack = true;
    b.autoAttack = true;
    this.broadcast(ServerMessage.Chat, {
      text: `⚔ DUEL: ${a.name} vs ${b.name} for 🪙${pending.stake} each — ${ZoneRoom.DUEL_SECONDS}s. Fight!`,
      from: "⚔ Duel",
    } as ChatMessage);
  }

  /** Pay the winner (90% of the pot; 10% burned) — or refund both on a draw. */
  private async resolveDuel(duel: { a: string; b: string; stake: number; timeLeft: number }, winnerId: string | null, why: string): Promise<void> {
    this.duels.delete(duel.a);
    this.duels.delete(duel.b);
    const nameOf = (id: string) => this.state.players.get(id)?.name ?? "??";
    if (!winnerId) {
      for (const id of [duel.a, duel.b]) {
        const rt = this.runtimes.get(id);
        const p = this.state.players.get(id);
        if (!rt) continue;
        const bal = await this.moveGold(rt, duel.stake, "duel_refund");
        if (bal !== null && p) p.gold = bal;
      }
      this.broadcast(ServerMessage.Chat, { text: `Duel ends in a draw (${why}) — stakes refunded.`, from: "⚔ Duel" } as ChatMessage);
      return;
    }
    const rtW = this.runtimes.get(winnerId);
    const pW = this.state.players.get(winnerId);
    const payout = Math.floor(duel.stake * 2 * ZoneRoom.DUEL_WINNER_SHARE);
    if (rtW) {
      const bal = await this.moveGold(rtW, payout, "duel_win");
      if (bal !== null && pW) pW.gold = bal;
    }
    const burned = duel.stake * 2 - payout;
    this.broadcast(ServerMessage.Chat, {
      text: `⚔ ${nameOf(winnerId)} wins the duel (${why}) — takes 🪙${payout}, 🪙${burned} burned.`,
      from: "⚔ Duel",
    } as ChatMessage);
  }

  /** Countdown + expiry sweep for duels and pending challenges. */
  private updateDuels(dt: number): void {
    const seen = new Set<object>();
    for (const duel of this.duels.values()) {
      if (seen.has(duel)) continue;
      seen.add(duel);
      duel.timeLeft -= dt;
      if (duel.timeLeft <= 0) void this.resolveDuel(duel, null, "time");
    }
    for (const [target, pending] of this.pendingDuels) {
      if (this.elapsedSeconds > pending.expiresAt) this.pendingDuels.delete(target);
    }
  }

  /** Send the player their own free-spin availability (targeted). */
  private async sendSpinner(client: Client, rt: PlayerRuntime): Promise<void> {
    if (!rt.accountId) {
      // Ticketless dev join: no persistent cooldown, always ready.
      client.send(ServerMessage.Spinner, { cooldownRemaining: 0 } as SpinnerMessage);
      return;
    }
    const res = await this.reporter.spinnerStatus(rt.accountId);
    client.send(ServerMessage.Spinner, { cooldownRemaining: res.cooldownRemaining ?? 0 } as SpinnerMessage);
  }

  /**
   * Take the free daily spin. The backend owns the cooldown + prize roll and
   * credits gold/stash itself; we relay the result and re-sync the affected
   * private panels (wallet via state, stash snapshot).
   */
  private async handleSpin(client: Client): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    if (!rt || rt.spinBusy) return;
    if (!rt.accountId) {
      // Ticketless dev join: spinning has nowhere to persist; report not-ready.
      client.send(ServerMessage.Spinner, { cooldownRemaining: 0 } as SpinnerMessage);
      return;
    }
    rt.spinBusy = true;
    try {
      const res = await this.reporter.spinnerSpin(rt.accountId);
      if (res.status === 429) {
        client.send(ServerMessage.Spinner, { cooldownRemaining: res.cooldownRemaining ?? 0 } as SpinnerMessage);
        return;
      }
      if (!res.ok || res.itemId === undefined || res.count === undefined) return;
      const prize: SpinResultMessage = {
        itemId: res.itemId,
        count: res.count,
        isGold: !!res.isGold,
        cooldownRemaining: res.cooldownRemaining ?? 86400,
      };
      client.send(ServerMessage.SpinResult, prize);
      client.send(ServerMessage.Spinner, { cooldownRemaining: prize.cooldownRemaining } as SpinnerMessage);
      // Reflect the reward: gold shows on the HUD immediately; an item lives in
      // the (private) stash, so push a fresh stash snapshot.
      if (prize.isGold) {
        const bal = await this.reporter.walletBalance(rt.accountId);
        const live = this.state.players.get(client.sessionId);
        if (live && bal.ok && bal.balance !== undefined) live.gold = bal.balance;
      } else {
        await this.sendStash(client, rt);
      }
    } finally {
      rt.spinBusy = false;
    }
  }

  /**
   * Re-pull everything the client holds privately after an out-of-band REST
   * change (e.g. a P2P marketplace buy/sell in the web UI): wallet, stash,
   * dailies, skins, spin availability.
   */
  private async refreshPrivate(client: Client): Promise<void> {
    const rt = this.runtimes.get(client.sessionId);
    if (!rt) return;
    if (rt.accountId) {
      const bal = await this.reporter.walletBalance(rt.accountId);
      const live = this.state.players.get(client.sessionId);
      if (live && bal.ok && bal.balance !== undefined) live.gold = bal.balance;
    }
    await this.sendStash(client, rt);
    await this.sendDailies(client, rt);
    await this.sendSkins(client, rt);
    await this.sendSpinner(client, rt);
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
      if (p.targetId) {
        p.autoAttack = !p.autoAttack;
        if (p.autoAttack) rt.engaging = true; // toggling on = "chase this target"
      }
      return;
    }

    // A locked skill can never fire — hard reject, never buffer.
    if (def.learnLevel > p.level) return;

    // Gated by GCD or its own cooldown? Buffer the press if it will clear within
    // the input-buffer window (fires from updateCooldowns the instant it opens),
    // otherwise drop it. This is the single biggest server responsiveness win.
    const gcdWait = def.offGcd ? 0 : rt.gcdRemaining;
    const ownCdWait = rt.cooldowns.get(def.id) ?? 0;
    const wait = Math.max(gcdWait, ownCdWait);
    if (wait > 0) {
      if (wait <= INPUT_BUFFER_SECONDS) {
        rt.queuedSlot = slotIndex;
        rt.queuedAt = this.elapsedSeconds;
      }
      return;
    }

    // Guards that must not waste the cooldown: targeted effects with no valid
    // target (or a melee target beyond reach).
    const targeted = def.effects.find(
      (e): e is Extract<SkillEffect, { type: "projectile_aoe" | "dash_strike" | "execute" | "lifesteal_strike" | "dot" }> =>
        e.type === "projectile_aoe" ||
        e.type === "dash_strike" ||
        e.type === "execute" ||
        e.type === "lifesteal_strike" ||
        e.type === "dot",
    );
    let target: EnemyController | null = null;
    if (targeted) {
      target = this.enemies.find((e) => e.state.id === p.targetId && e.state.alive) ?? null;
      if (!target) return;
      // Melee strikes reject an out-of-reach target; ranged casts (projectile,
      // curse) land at any range on the current target. Scan the WHOLE effect
      // list, not just the first targeted effect — a composite like rupture
      // (dot + melee strike) must still be gated by its melee component.
      for (const e of def.effects) {
        if (e.type === "dash_strike" || e.type === "execute" || e.type === "lifesteal_strike") {
          const d = Math.hypot(target.state.x - p.x, target.state.z - p.z);
          if (d > e.range + 0.5) return;
        }
      }
    }

    // Commit: per-skill cooldown + GCD, then execute the effect list.
    if (def.cooldown > 0) rt.cooldowns.set(def.id, def.cooldown);
    if (!def.offGcd) this.startGlobalCooldown(rt, p);
    // Reserve the swing timer for the cast: otherwise an auto-attack that comes
    // due mid-windup overwrites the skill's action state, and the skill's
    // scheduled impact (which re-checks isCurrentAction) silently fizzles.
    rt.attackCooldown = Math.max(rt.attackCooldown, actionDuration(DEFAULT_SKILL_TIMING));
    for (const effect of def.effects) this.runEffect(playerId, rt, p, effect, target, def.id);
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
    skillId: string,
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
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId }, skillId);
        return;
      }

      case "self_buff": {
        if (effect.kind === "damage_amp") {
          rt.ampSeconds = effect.duration;
          rt.ampValue = effect.value;
        } else {
          rt.bulwarkSeconds = effect.duration;
          rt.bulwarkValue = effect.value;
        }
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId }, skillId);
        return;
      }

      case "heal_ally": {
        // Smart-heal: the most-wounded living player within radius (incl. self).
        let best: PlayerState | null = null;
        let bestRatio = Infinity;
        this.state.players.forEach((ally) => {
          if (!ally.alive || ally.hp >= ally.maxHp) return;
          if (Math.hypot(ally.x - p.x, ally.z - p.z) > effect.radius) return;
          const ratio = ally.hp / Math.max(1, ally.maxHp);
          if (ratio < bestRatio) {
            bestRatio = ratio;
            best = ally;
          }
        });
        // Nobody hurt in range → heal the caster (never wastes the cast/cooldown).
        const heal: PlayerState = best ?? p;
        const { newHp, effective } = applyHeal(heal.hp, heal.maxHp, effect.fraction);
        heal.hp = newHp;
        this.applyHealThreat(playerId, effective); // healing draws aggro to the CASTER
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), heal.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: heal.id, amount: -effective, kind: "heal", actionId }, skillId);
        return;
      }

      case "lifesteal_strike": {
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
          this.damageEnemy(playerId, liveRt, source, live, effect.damage, "skill", actionId, skillId);
          // Drain: heal the caster for a fraction of the strike's nominal damage.
          const { newHp, effective } = applyHeal(source.hp, source.maxHp, (effect.damage * effect.lifesteal) / source.maxHp);
          if (effective > 0) {
            source.hp = newHp;
            this.emitCombat({ sourceId: source.id, targetId: source.id, amount: -effective, kind: "heal", actionId: this.nextActionId() }, skillId);
          }
        });
        return;
      }

      case "dot": {
        if (!target) return;
        this.facePlayerToEnemy(p, target);
        target.applyDot(playerId, effect.damage, effect.tick, effect.duration, skillId);
        // Seed threat immediately so the curse pulls aggro like any other cast.
        target.addThreat(playerId, effect.damage);
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), target.state.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: target.state.id, amount: 0, kind: "skill", actionId }, skillId);
        return;
      }

      case "taunt": {
        for (const enemy of this.enemies) {
          if (!enemy.state.alive) continue;
          if (Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z) > effect.radius) continue;
          enemy.taunt(playerId);
        }
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId }, skillId);
        return;
      }

      case "heal_self": {
        const { newHp, effective } = applyHeal(p.hp, p.maxHp, effect.fraction);
        p.hp = newHp;
        this.applyHealThreat(playerId, effective);
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        // Negative amount renders as a green heal number (see CombatFloaters).
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: -effective, kind: "heal", actionId }, skillId);
        return;
      }

      case "aura_dot": {
        rt.frostSeconds = effect.duration;
        rt.frostTick = 0;
        rt.frostAura = { radius: effect.radius, tick: effect.tick, damage: effect.damage, skillId };
        p.frostSeconds = rt.frostSeconds;
        const actionId = this.nextActionId();
        this.setAction(p, "skill", actionDuration(DEFAULT_SKILL_TIMING), p.id, actionId);
        this.emitCombat({ sourceId: p.id, targetId: p.id, amount: 0, kind: "skill", actionId }, skillId);
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
            this.damageEnemy(playerId, liveRt, source, enemy, effect.damage, "skill", actionId, skillId);
          }
          // Always emit a self-anchored cast event (drives the client's caster
          // ground FX / cast flash); on a whiff it's also the "nothing hit" signal.
          this.emitCombat({ sourceId: source.id, targetId: source.id, amount: 0, kind: "skill", actionId }, skillId);
          void hit;
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
            this.damageEnemy(playerId, liveRt, source, enemy, effect.damage, "skill", actionId, skillId);
          }
          // Always emit a self-anchored cast event (drives the client's caster
          // ground FX / cast flash); on a whiff it's also the "nothing hit" signal.
          this.emitCombat({ sourceId: source.id, targetId: source.id, amount: 0, kind: "skill", actionId }, skillId);
          void hit;
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
          this.damageEnemy(playerId, liveRt, source, live, effect.damage, "skill", actionId, skillId);
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
          this.damageEnemy(playerId, liveRt, source, live, raw, "skill", actionId, skillId);
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
              if (d <= effect.radius) this.damageEnemy(playerId, rtNow, liveSource, enemy, effect.damage, "skill", actionId, skillId);
            }
          }, skillId);
        });
        return;
      }
    }
  }

  private enemyHitsPlayer(enemy: EnemyController, playerId: string): void {
    const actionId = this.nextActionId();
    // Heavier enemies telegraph with a longer wind-up (per-def), so the hit is
    // readable and dodgeable — resolveEnemyHit re-checks range at impact.
    const timing = enemy.def.attackTiming ?? DEFAULT_ENEMY_ATTACK_TIMING;
    this.setAction(enemy.state, "attack", actionDuration(timing), playerId, actionId);
    this.scheduleImpact(actionId, timing.windup, () => this.resolveEnemyHit(enemy, playerId, actionId));
  }

  private resolveEnemyHit(enemy: EnemyController, playerId: string, actionId: string): void {
    const p = this.state.players.get(playerId);
    if (!enemy.state.alive || !p || !p.alive || !this.isCurrentAction(enemy.state, actionId)) return;
    const d = Math.hypot(enemy.state.x - p.x, enemy.state.z - p.z);
    if (d > enemy.def.attackRange + 0.65) return; // juked out during the wind-up
    this.dealEnemyDamageToPlayer(enemy, playerId, enemy.def.attackDamage, actionId);
  }

  /**
   * Telegraphed ground-slam: broadcast a warning ring, then after the wind-up
   * hit every player still inside the radius. Dodgeable by leaving the ring —
   * the radius is captured where the slam started, so moving out avoids it.
   */
  private enemySpecialSlam(enemy: EnemyController): void {
    const special = enemy.def.special;
    if (!special) return;
    const actionId = this.nextActionId();
    const slamX = enemy.state.x;
    const slamZ = enemy.state.z;
    this.setAction(enemy.state, "attack", special.windup + special.recovery, enemy.state.targetId, actionId);
    const tele: TelegraphMessage = { sourceId: enemy.state.id, x: slamX, z: slamZ, radius: special.radius, windupMs: special.windup * 1000 };
    this.broadcast(ServerMessage.Telegraph, tele);
    this.scheduleImpact(actionId, special.windup, () => {
      if (!enemy.state.alive || !this.isCurrentAction(enemy.state, actionId)) return;
      this.state.players.forEach((p, pid) => {
        if (!p.alive) return;
        if (Math.hypot(p.x - slamX, p.z - slamZ) > special.radius) return; // stepped out
        this.dealEnemyDamageToPlayer(enemy, pid, special.damage, actionId);
      });
      // Impact flash at the slam center (drives ImpactFx).
      this.emitCombat({ sourceId: enemy.state.id, targetId: enemy.state.id, amount: 0, kind: "skill", actionId });
    });
  }

  /** One duel basic-attack swing: same cadence/range/crit as PvE, resolved
   *  against the opponent PLAYER instead of an enemy controller. */
  private duelSwing(id: string, rt: PlayerRuntime, p: PlayerState, opponentId: string): void {
    const foe = this.state.players.get(opponentId);
    if (!foe || !foe.alive) return;
    const d = Math.hypot(foe.x - p.x, foe.z - p.z);
    const range = attackRangeFor(rt.profile, p.weaponId);
    if (d > range) return; // players steer themselves in duels — no auto-chase
    this.facePlayerToPoint(p, foe.x, foe.z);
    rt.attackCooldown = swingIntervalFor(rt.profile, p.weaponId);
    const actionId = this.nextActionId();
    this.setAction(p, "attack", actionDuration(DEFAULT_MELEE_ATTACK_TIMING), foe.id, actionId);
    this.scheduleImpact(actionId, DEFAULT_MELEE_ATTACK_TIMING.windup, () => {
      const source = this.state.players.get(id);
      const target = this.state.players.get(opponentId);
      const liveRt = this.runtimes.get(id);
      if (!source || !liveRt || !source.alive || !target?.alive || !this.isCurrentAction(source, actionId)) return;
      if (!this.duels.has(id)) return; // duel ended mid-swing
      if (Math.hypot(target.x - source.x, target.z - source.z) > range + 0.9) return;
      const isCrit = Math.random() < critChanceFor(source.weaponId);
      const raw = basicAttackRaw(source, liveRt);
      this.dealPvpDamageToPlayer(id, opponentId, raw, isCrit, actionId);
    });
  }

  /** Apply one duel hit (shield/armor/bulwark respected). A kill resolves the
   *  duel; death costs durability exactly like a PvE death. */
  private dealPvpDamageToPlayer(sourceId: string, targetId: string, rawDamage: number, isCrit: boolean, actionId: string): void {
    const source = this.state.players.get(sourceId);
    const p = this.state.players.get(targetId);
    const rt = this.runtimes.get(targetId);
    if (!source || !p || !rt || !p.alive) return;
    if (rt.shieldSeconds > 0) {
      this.emitCombat({ sourceId, targetId: p.id, amount: 0, kind: "skill", actionId });
      return;
    }
    const playerArmor = p.level * 5;
    let dmg = resolveDamage(rawDamage, playerArmor, source.level, isCrit);
    if (rt.bulwarkSeconds > 0 && rt.bulwarkValue > 0) {
      dmg = Math.max(1, Math.round(dmg * (1 - rt.bulwarkValue)));
    }
    p.hp = Math.max(0, p.hp - dmg);
    const midAction = (p.actionState === "skill" || p.actionState === "attack") && this.elapsedSeconds < p.actionEndsAt;
    if (!midAction) this.setAction(p, "hit", 0.3, sourceId, actionId);
    this.emitCombat({ sourceId, targetId: p.id, amount: dmg, kind: isCrit ? "crit" : "hit", actionId });
    if (p.hp <= 0) {
      p.alive = false;
      p.targetId = "";
      p.autoAttack = false;
      rt.respawnTimer = 4;
      this.setAction(p, "dead", rt.respawnTimer, sourceId, actionId);
      for (const e of this.enemies) e.removeThreat(targetId);
      this.emitCombat({ sourceId, targetId: p.id, amount: 0, kind: "death", actionId });
      // Same durability tax as a PvE death — dying is dying.
      if (p.weaponId && rt.weaponUses > 0) {
        rt.weaponUses = Math.max(0, rt.weaponUses - DEATH_DURABILITY_COST);
        if (rt.weaponUses === 0) {
          const broken = itemDef(p.weaponId)?.name ?? "weapon";
          p.weaponId = "";
          this.tell(targetId, `Your ${broken} shattered on death!`);
        }
      }
      const duel = this.duels.get(targetId);
      if (duel) void this.resolveDuel(duel, sourceId, "knockout");
    }
  }

  /** Apply one enemy hit to a player (shield/armor/bulwark/death), shared by the
   *  basic attack and the ground-slam AoE. */
  private dealEnemyDamageToPlayer(enemy: EnemyController, playerId: string, rawDamage: number, actionId: string): void {
    const p = this.state.players.get(playerId);
    const rt = this.runtimes.get(playerId);
    if (!p || !rt || !p.alive) return;
    if (rt.shieldSeconds > 0) {
      this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: 0, kind: "skill", actionId });
      return;
    }
    const playerArmor = p.level * 5;
    let dmg = resolveDamage(rawDamage, playerArmor, enemy.def.level, false);
    if (rt.bulwarkSeconds > 0 && rt.bulwarkValue > 0) {
      dmg = Math.max(1, Math.round(dmg * (1 - rt.bulwarkValue)));
    }
    p.hp = Math.max(0, p.hp - dmg);
    // Hit-react only when it won't cancel an in-flight swing/cast: overwriting
    // a "skill"/"attack" action here made the pending impact fail its
    // isCurrentAction check — the skill ate cooldown + GCD but never landed
    // (guaranteed vs fast-hitting elites in melee). Death below still cancels.
    const midAction = (p.actionState === "skill" || p.actionState === "attack") && this.elapsedSeconds < p.actionEndsAt;
    if (!midAction) this.setAction(p, "hit", 0.3, enemy.state.id, actionId);
    this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: dmg, kind: "hit", actionId });
    if (p.hp <= 0) {
      p.alive = false;
      p.targetId = "";
      p.autoAttack = false;
      rt.respawnTimer = 4;
      this.setAction(p, "dead", rt.respawnTimer, enemy.state.id, actionId);
      for (const e of this.enemies) e.removeThreat(playerId);
      this.emitCombat({ sourceId: enemy.state.id, targetId: p.id, amount: 0, kind: "death", actionId });
      // Economy v2 durability tax: dying chips the equipped weapon; at 0 it
      // BREAKS (repair at the forge before that, or lose it) — combat destroys
      // value, so crafters always have customers.
      if (p.weaponId && rt.weaponUses > 0) {
        rt.weaponUses = Math.max(0, rt.weaponUses - DEATH_DURABILITY_COST);
        if (rt.weaponUses === 0) {
          const broken = itemDef(p.weaponId)?.name ?? "weapon";
          p.weaponId = "";
          this.clients
            .find((c) => c.sessionId === playerId)
            ?.send(ServerMessage.Chat, { text: `Your ${broken} shattered on death!`, from: "⚒" } as ChatMessage);
        }
      }
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
    skillId = "",
  ): void {
    // Blessing (Cleric) amps ALL of the caster's outgoing damage — basic
    // attacks, skills, lifesteal, and DoT ticks all route through here.
    if (rt.ampSeconds > 0 && rt.ampValue > 0) amount = Math.round(amount * (1 + rt.ampValue));
    enemy.addThreat(playerId, Math.max(1, amount));
    const killed = enemy.takeDamage(amount);
    if (!killed) this.setAction(enemy.state, "hit", 0.28, playerId, actionId);
    this.emitCombat({ sourceId: playerId, targetId: enemy.state.id, amount, kind, actionId }, skillId);
    if (killed) {
      this.setAction(enemy.state, "dying", ENEMY_DYING_SECONDS, playerId, actionId);
      this.emitCombat({ sourceId: playerId, targetId: enemy.state.id, amount: 0, kind: "death", actionId }, skillId);
      // Economy v2: no depth multipliers — the def itself carries the zone/tier
      // scaling (area rosters + coliseumBossForTier).
      this.awardKill(rt, p, enemy.def.xpValue, enemy.def.currencyValue);
      this.bumpDaily(rt, "kill", enemy.def.id, 1);
      this.rollMaterialDrops(rt, p, enemy.def);
      this.rollKillLoot(rt, p, enemy.def.rank as LootRank);
      // Coliseum world boss levels up on each slaying and re-forms tougher —
      // the tier ladder is the endgame progression (replaces the old depth).
      if (enemy.def.id === "coliseum_champion") {
        this.coliseumTier++;
        this.state.coliseumTier = this.coliseumTier;
        this.coliseumRespawnTimer = 25;
        this.runtimes.forEach((prt, playerId) => {
          if (this.state.players.get(playerId)) this.bumpDaily(prt, "coliseum", "", 1);
        });
        const payload: ChatMessage = { text: `The Coliseum champion falls… Tier ${this.coliseumTier} re-forms, stronger.`, from: "⚔ Coliseum" };
        this.broadcast(ServerMessage.Chat, payload);
      }
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
  /** Economy v2: kills pay MATERIALS — roll each entry of the def's drop table
   *  into the killer's bag (bag-full drops are simply lost, same as gear loot). */
  private rollMaterialDrops(rt: PlayerRuntime, p: PlayerState, def: EnemyDef): void {
    if (!def.drops?.length) return;
    let granted = false;
    for (const drop of def.drops) {
      if (this.lootRng.nextFloat01() > drop.chance) continue;
      const count = drop.count ?? 1;
      const leftover = addStacked(rt.bag, BAG_CAPACITY, drop.itemId, count);
      if (leftover >= count) continue; // bag full
      granted = true;
      const item = itemDef(drop.itemId);
      this.broadcast(ServerMessage.LootEvent, { playerId: p.id, itemId: drop.itemId, rarity: item?.rarity ?? "" } as LootEventMessage);
    }
    if (granted) this.syncBag(p, rt);
  }

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

  private emitCombat(event: CombatEventMessage, skillId = ""): void {
    // Per-skill discriminator for client VFX/SFX/anim (e.g. "fireball", "smite",
    // "basic_attack"); omitted for enemy attacks and other non-skill sources.
    if (skillId && !event.skillId) event.skillId = skillId;
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

  private launchProjectile(actionId: string, source: PlayerState, target: EnemyState, resolve: ProjectileResolver, skillId = ""): void {
    const distance = Math.hypot(target.x - source.x, target.z - source.z);
    const timing = projectileTiming(distance, 0, PROJECTILE_SPEED_UNITS_PER_SECOND);
    this.emitCombat({
      sourceId: source.id,
      targetId: target.id,
      amount: 0,
      kind: "skill",
      actionId,
      impactDelayMs: timing.travelTime * 1000,
    }, skillId);
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

  // Official map: each leveled AREA gets its own roster (minion/elite/boss) at
  // its own spawns; the Coliseum gets the world boss. Procedural map: the flat
  // uniform spawn (grunts/elite/brute) as before.
  private spawnInitialEnemies(): void {
    const areas = this.dungeon.areas;
    if (areas?.length) {
      for (const area of areas) {
        const roster = AREA_ROSTERS[area.id - 1];
        if (roster) for (const pt of area.normalSpawns) this.spawnEnemy(roster.minion, pt.x, pt.z);
      }
      return;
    }
    this.dungeon.normalSpawns.slice(0, INITIAL_ENEMY_COUNT).forEach((pt) => this.spawnEnemy(GRUNT, pt.x, pt.z));
  }

  private spawnInitialElites(): void {
    const areas = this.dungeon.areas;
    if (areas?.length) {
      for (const area of areas) {
        const roster = AREA_ROSTERS[area.id - 1];
        if (roster) for (const pt of area.eliteSpawns) this.spawnEnemy(roster.elite, pt.x, pt.z);
      }
      return;
    }
    this.dungeon.eliteSpawns.slice(0, INITIAL_ELITE_COUNT).forEach((pt) => this.spawnEnemy(ELITE_GRUNT, pt.x, pt.z));
  }

  private spawnInitialBoss(): void {
    const areas = this.dungeon.areas;
    if (areas?.length) {
      for (const area of areas) {
        const roster = AREA_ROSTERS[area.id - 1];
        if (roster) this.spawnEnemy(roster.boss, area.bossPoint.x, area.bossPoint.z);
      }
      if (this.dungeon.coliseumPortal) this.spawnEnemy(COLISEUM_BOSS, this.dungeon.coliseumPortal.x, this.dungeon.coliseumPortal.z);
      return;
    }
    const point = this.dungeon.bossPortal;
    this.spawnEnemy(BOSS_BRUTE, point.x, point.z);
  }

  private spawnEnemy(baseDef: EnemyDef, x: number, z: number): EnemyController {
    // Economy v2: no depth multipliers — zone rosters and coliseumBossForTier
    // already bake difficulty/reward scaling into the def itself.
    const def: EnemyDef = baseDef;
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
