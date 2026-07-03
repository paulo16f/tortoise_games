// Colyseus authoritative room state. These classes are the wire format:
// the realtime server mutates them; the client imports the SAME classes so
// colyseus.js decodes into typed objects. Data only — no behavior.
//
// Uses the decorator-free `defineTypes` API (not @type decorators) so the
// schema transpiles identically under tsx/esbuild (server) and Vite/esbuild
// (client) without per-tool experimentalDecorators configuration. Fields are
// declared with definite assignment (no initializers) and set in the
// constructor to avoid useDefineForClassFields conflicts across bundlers.

import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

/** One connected player. `id` equals the Colyseus sessionId. */
export class PlayerState extends Schema {
  id!: string;
  accountId!: string;
  characterId!: string;
  name!: string;
  classId!: string;

  x!: number;
  y!: number;
  z!: number;
  yaw!: number;

  hp!: number;
  maxHp!: number;
  level!: number;
  runXp!: number;

  /** Current target entity id (player or enemy), empty when none. */
  targetId!: string;
  alive!: boolean;

  constructor() {
    super();
    this.id = "";
    this.accountId = "";
    this.characterId = "";
    this.name = "";
    this.classId = "bruiser";
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.level = 1;
    this.runXp = 0;
    this.targetId = "";
    this.alive = true;
  }
}

defineTypes(PlayerState, {
  id: "string",
  accountId: "string",
  characterId: "string",
  name: "string",
  classId: "string",
  x: "number",
  y: "number",
  z: "number",
  yaw: "number",
  hp: "number",
  maxHp: "number",
  level: "number",
  runXp: "number",
  targetId: "string",
  alive: "boolean",
});

/** One server-driven enemy. */
export class EnemyState extends Schema {
  id!: string;
  defId!: string;
  x!: number;
  y!: number;
  z!: number;
  yaw!: number;
  hp!: number;
  maxHp!: number;
  /** FSM state name: "idle" | "aggro" | "combat" | "leash". */
  fsm!: string;
  targetId!: string;
  alive!: boolean;

  constructor() {
    super();
    this.id = "";
    this.defId = "";
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.hp = 50;
    this.maxHp = 50;
    this.fsm = "idle";
    this.targetId = "";
    this.alive = true;
  }
}

defineTypes(EnemyState, {
  id: "string",
  defId: "string",
  x: "number",
  y: "number",
  z: "number",
  yaw: "number",
  hp: "number",
  maxHp: "number",
  fsm: "string",
  targetId: "string",
  alive: "boolean",
});

/** Root synced state for a zone room. */
export class ZoneState extends Schema {
  zoneId!: string;
  seed!: number;
  depth!: number;
  players!: MapSchema<PlayerState>;
  enemies!: MapSchema<EnemyState>;

  constructor() {
    super();
    this.zoneId = "hub";
    this.seed = 0;
    this.depth = 0;
    this.players = new MapSchema<PlayerState>();
    this.enemies = new MapSchema<EnemyState>();
  }
}

defineTypes(ZoneState, {
  zoneId: "string",
  seed: "number",
  depth: "number",
  players: { map: PlayerState },
  enemies: { map: EnemyState },
});
