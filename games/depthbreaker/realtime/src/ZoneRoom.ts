// Authoritative zone room (design doc §3, §4). Server owns all movement,
// combat, XP, and enemy AI; clients send inputs and requests only. Phase 0 is
// a single shared hub room so players see each other immediately.

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
  type CombatEventMessage,
  type WelcomeMessage,
} from "@depthbreaker/protocol";
import { resolveDamage, levelForTotalXp, maxCurrencyForDepth, maxXpForDepth } from "@depthbreaker/sim";
import { EnemyController, GRUNT, type CombatTarget } from "./enemies.js";
import { verifyJoinTicket, type JoinTicketClaims } from "./joinTicket.js";
import { BackendReporter } from "./backendReporter.js";
import { loadConfig, type RealtimeConfig } from "./config.js";

const ARENA_RADIUS = 45;
const PLAYER_MAX_HP = 100;
const PLAYER_CRIT_CHANCE = 0.15;

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

/** Runtime-only per-player data (not synced). */
interface PlayerRuntime {
  input: { moveX: number; moveZ: number; yaw: number };
  attackCooldown: number;
  respawnTimer: number;
  profile: ClassProfile;
  runId: string | null;
  characterId: string;
  earnedXp: number;
  earnedCurrency: number;
  ticketed: boolean;
}

/** Colyseus attaches onAuth's return value to client.auth. */
type AuthData = { claims: JoinTicketClaims | null; classId: ClassId; name: string };

export class ZoneRoom extends Room<ZoneState> {
  private config: RealtimeConfig = loadConfig();
  private reporter = new BackendReporter(this.config.backendUrl, this.config.zoneSharedSecret);
  private runtimes = new Map<string, PlayerRuntime>();
  private enemies: EnemyController[] = [];
  private tick = 0;

  override onCreate(): void {
    this.setState(new ZoneState());
    this.state.zoneId = "hub";

    this.spawnEnemies();

    this.onMessage(ClientMessage.Input, (client, message: InputMessage) => {
      const rt = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!rt || !player || !player.alive) return;
      // Clamp to unit square; server owns resulting position.
      rt.input.moveX = Math.max(-1, Math.min(1, message.moveX ?? 0));
      rt.input.moveZ = Math.max(-1, Math.min(1, message.moveZ ?? 0));
      rt.input.yaw = message.yaw ?? player.yaw;
    });

    this.onMessage(CM.SetTarget, (client, message: SetTargetMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const id = message.targetId ?? "";
      // Only allow targeting a currently-known, alive enemy (or clearing).
      if (id === "") {
        player.targetId = "";
      } else if (this.state.enemies.get(id)?.alive) {
        player.targetId = id;
      }
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
    // Dev: ticketless join allowed (config.requireTicket === false).
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
    // Drop this player's threat from every enemy.
    for (const enemy of this.enemies) enemy.removeThreat(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);

    // Report the run as abandoned so the backend credits earned currency once.
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

  // --- simulation --------------------------------------------------------

  private update(dt: number): void {
    this.tick++;
    this.movePlayers(dt);

    const targets = this.buildTargetMap();
    this.updateEnemies(dt, targets);
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
        p.x += nx * PLAYER_SPEED * dt;
        p.z += nz * PLAYER_SPEED * dt;
        p.yaw = Math.atan2(nx, nz);
        // Keep inside the arena.
        const r = Math.hypot(p.x, p.z);
        if (r > ARENA_RADIUS) {
          p.x = (p.x / r) * ARENA_RADIUS;
          p.z = (p.z / r) * ARENA_RADIUS;
        }
      }
    });
  }

  private buildTargetMap(): Map<string, CombatTarget> {
    const targets = new Map<string, CombatTarget>();
    this.state.players.forEach((p) => {
      targets.set(p.id, { id: p.id, x: p.x, z: p.z, alive: p.alive });
    });
    return targets;
  }

  private updateEnemies(dt: number, targets: Map<string, CombatTarget>): void {
    for (const enemy of this.enemies) {
      const action = enemy.update(dt, targets);
      if (action.attackTargetId) {
        this.enemyHitsPlayer(enemy, action.attackTargetId);
      }
    }
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

      rt.attackCooldown = rt.profile.attackInterval;
      const isCrit = Math.random() < PLAYER_CRIT_CHANCE;
      const dmg = resolveDamage(rt.profile.attackRaw, enemy.def.armor, p.level, isCrit);
      enemy.addThreat(id, dmg);
      const killed = enemy.takeDamage(dmg);
      this.emitCombat({ sourceId: id, targetId: enemy.state.id, amount: dmg, kind: isCrit ? "crit" : "hit" });

      if (killed) {
        this.emitCombat({ sourceId: id, targetId: enemy.state.id, amount: 0, kind: "death" });
        this.awardKill(rt, p, enemy.def.xpValue, enemy.def.currencyValue);
        if (p.targetId === enemy.state.id) p.targetId = "";
      }
    });
  }

  private enemyHitsPlayer(enemy: EnemyController, playerId: string): void {
    const p = this.state.players.get(playerId);
    const rt = this.runtimes.get(playerId);
    if (!p || !rt || !p.alive) return;
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

  // --- helpers -----------------------------------------------------------

  private emitCombat(event: CombatEventMessage): void {
    this.broadcast(ServerMessage.CombatEvent, event);
  }

  private spawnEnemies(): void {
    const points = [
      { x: 8, z: 8 },
      { x: -10, z: 6 },
      { x: 4, z: -12 },
      { x: -8, z: -9 },
    ];
    points.forEach((pt, i) => {
      const state = new EnemyState();
      state.id = `grunt-${i}`;
      state.defId = GRUNT.id;
      state.maxHp = GRUNT.maxHp;
      state.hp = GRUNT.maxHp;
      state.x = pt.x;
      state.z = pt.z;
      state.fsm = "idle";
      state.alive = true;
      this.state.enemies.set(state.id, state);
      this.enemies.push(new EnemyController(state, GRUNT, pt.x, pt.z));
    });
  }

  private ringSpawn(index: number): { x: number; z: number } {
    const angle = (index * Math.PI * 2) / 6 + Math.PI / 7;
    const r = 3;
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
  }
}
