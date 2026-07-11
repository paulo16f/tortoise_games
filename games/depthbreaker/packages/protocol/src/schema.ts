// Colyseus authoritative room state. These classes are the wire format:
// the realtime server mutates them; the client imports the SAME classes so
// colyseus.js decodes into typed objects. Data only, no behavior.

import { Schema, MapSchema, ArraySchema, defineTypes } from "@colyseus/schema";

/** One bag slot. itemId "" marks an empty slot; count 0 with itemId "" is empty. */
export class ItemSlotState extends Schema {
  declare itemId: string;
  declare count: number;
  /** Rarity string for UI tinting ("" for base/unknown items). */
  declare rarity: string;

  constructor() {
    super();
    this.itemId = "";
    this.count = 0;
    this.rarity = "";
  }
}

defineTypes(ItemSlotState, {
  itemId: "string",
  count: "number",
  rarity: "string",
});

/** One hotbar slot. skillId "" marks an empty slot. */
export class SkillSlotState extends Schema {
  declare skillId: string;
  /** Seconds until this skill is usable again (0 = ready). */
  declare cooldownRemaining: number;
  /** False while the character's level is below the skill's learnLevel. */
  declare unlocked: boolean;

  constructor() {
    super();
    this.skillId = "";
    this.cooldownRemaining = 0;
    this.unlocked = false;
  }
}

defineTypes(SkillSlotState, {
  skillId: "string",
  cooldownRemaining: "number",
  unlocked: "boolean",
});

/** One gatherable mining node. Position is static; only depleted changes. */
export class ResourceNodeState extends Schema {
  declare id: string;
  /** "iron_vein" | "crystal_vein" (string on the wire). */
  declare kind: string;
  declare x: number;
  declare z: number;
  declare depleted: boolean;

  constructor() {
    super();
    this.id = "";
    this.kind = "iron_vein";
    this.x = 0;
    this.z = 0;
    this.depleted = false;
  }
}

defineTypes(ResourceNodeState, {
  id: "string",
  kind: "string",
  x: "number",
  z: "number",
  depleted: "boolean",
});

/** One connected player. `id` equals the Colyseus sessionId. */
export class PlayerState extends Schema {
  declare id: string;
  declare accountId: string;
  declare characterId: string;
  declare name: string;
  declare classId: string;

  declare x: number;
  declare y: number;
  declare z: number;
  declare yaw: number;

  declare hp: number;
  declare maxHp: number;
  declare level: number;
  declare runXp: number;
  /** Persistent wallet gold (meta_wallets), synced for the HUD/market UI. */
  declare gold: number;

  /** Current target entity id (player or enemy), empty when none. */
  declare targetId: string;
  /** Whether the server should auto-follow and basic-attack the current target. */
  declare autoAttack: boolean;
  /** Currently equipped weapon item id; v1 exposes weapon only. */
  declare weaponId: string;
  declare alive: boolean;
  declare actionState: string;
  declare actionStartedAt: number;
  declare actionEndsAt: number;
  declare actionTargetId: string;
  declare actionId: string;
  /** Seconds until the healing potion is usable again (0 = ready). */
  declare potionCooldown: number;
  /** Shared global cooldown remaining; blocks all class skills (0 = ready). */
  declare gcdRemaining: number;
  /** Seconds until the next auto-attack swing (0 = ready). */
  declare swingCooldown: number;
  /** Full auto-attack swing period, so the client can draw a fill fraction. */
  declare swingInterval: number;
  /** Seconds of warrior immunity remaining. */
  declare shieldSeconds: number;
  /** Seconds of mage orbiting frost projectiles remaining. */
  declare frostSeconds: number;
  /** Fixed-length bag; empty slots have itemId "". Weapon is `weaponId`, not here. */
  declare inventory: ArraySchema<ItemSlotState>;
  /** Fixed 10-slot hotbar (keys 1-9,0). Layout comes from hotbarLayout(classId). */
  declare hotbar: ArraySchema<SkillSlotState>;

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
    this.gold = 0;
    this.targetId = "";
    this.autoAttack = false;
    this.weaponId = "iron_sword";
    this.alive = true;
    this.actionState = "idle";
    this.actionStartedAt = 0;
    this.actionEndsAt = 0;
    this.actionTargetId = "";
    this.actionId = "";
    this.potionCooldown = 0;
    this.gcdRemaining = 0;
    this.swingCooldown = 0;
    this.swingInterval = 0;
    this.shieldSeconds = 0;
    this.frostSeconds = 0;
    this.inventory = new ArraySchema<ItemSlotState>();
    this.hotbar = new ArraySchema<SkillSlotState>();
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
  gold: "number",
  targetId: "string",
  autoAttack: "boolean",
  weaponId: "string",
  alive: "boolean",
  actionState: "string",
  actionStartedAt: "number",
  actionEndsAt: "number",
  actionTargetId: "string",
  actionId: "string",
  potionCooldown: "number",
  gcdRemaining: "number",
  swingCooldown: "number",
  swingInterval: "number",
  shieldSeconds: "number",
  frostSeconds: "number",
  inventory: [ItemSlotState],
  hotbar: [SkillSlotState],
});

/** One server-driven enemy. */
export class EnemyState extends Schema {
  declare id: string;
  declare defId: string;
  declare rank: string;
  declare x: number;
  declare y: number;
  declare z: number;
  declare yaw: number;
  declare hp: number;
  declare maxHp: number;
  /** FSM state name: "idle" | "aggro" | "combat" | "leash". */
  declare fsm: string;
  declare targetId: string;
  declare alive: boolean;
  declare actionState: string;
  declare actionStartedAt: number;
  declare actionEndsAt: number;
  declare actionTargetId: string;
  declare actionId: string;

  constructor() {
    super();
    this.id = "";
    this.defId = "";
    this.rank = "normal";
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.hp = 50;
    this.maxHp = 50;
    this.fsm = "idle";
    this.targetId = "";
    this.alive = true;
    this.actionState = "idle";
    this.actionStartedAt = 0;
    this.actionEndsAt = 0;
    this.actionTargetId = "";
    this.actionId = "";
  }
}

defineTypes(EnemyState, {
  id: "string",
  defId: "string",
  rank: "string",
  x: "number",
  y: "number",
  z: "number",
  yaw: "number",
  hp: "number",
  maxHp: "number",
  fsm: "string",
  targetId: "string",
  alive: "boolean",
  actionState: "string",
  actionStartedAt: "number",
  actionEndsAt: "number",
  actionTargetId: "string",
  actionId: "string",
});

export class BossPortalState extends Schema {
  declare active: boolean;
  declare x: number;
  declare z: number;
  declare countdown: number;

  constructor() {
    super();
    this.active = false;
    this.x = 0;
    this.z = 0;
    this.countdown = 0;
  }
}

defineTypes(BossPortalState, {
  active: "boolean",
  x: "number",
  z: "number",
  countdown: "number",
});

/** Root synced state for a zone room. */
export class ZoneState extends Schema {
  declare zoneId: string;
  declare seed: number;
  declare depth: number;
  declare players: MapSchema<PlayerState>;
  declare enemies: MapSchema<EnemyState>;
  declare nodes: MapSchema<ResourceNodeState>;
  declare bossPortal: BossPortalState;

  constructor() {
    super();
    this.zoneId = "hub";
    this.seed = 0;
    this.depth = 0;
    this.players = new MapSchema<PlayerState>();
    this.enemies = new MapSchema<EnemyState>();
    this.nodes = new MapSchema<ResourceNodeState>();
    this.bossPortal = new BossPortalState();
  }
}

defineTypes(ZoneState, {
  zoneId: "string",
  seed: "number",
  depth: "number",
  players: { map: PlayerState },
  enemies: { map: EnemyState },
  nodes: { map: ResourceNodeState },
  bossPortal: BossPortalState,
});
