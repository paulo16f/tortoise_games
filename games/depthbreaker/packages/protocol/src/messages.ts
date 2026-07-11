// Client <-> server message contract. Colyseus messages are addressed by a
// string type; these constants + payload interfaces keep both ends in sync.

/** Client -> server. */
export const ClientMessage = {
  /** Held-movement sample; the server is authoritative over resulting position. */
  Input: "input",
  /** Request to target an entity (player or enemy) by its state id. */
  SetTarget: "setTarget",
  /** Toggle server-authoritative auto attack for the current target. */
  SetAutoAttack: "setAutoAttack",
  /** Cast the skill in a hotbar slot. Keys 1-9,0 map to slots 0-9. */
  UseSkill: "useSkill",
  /** Equip or unequip the currently available class weapon. */
  ToggleWeapon: "toggleWeapon",
  /** Equip a specific weapon out of the bag; the previous weapon returns to the bag. */
  EquipWeapon: "equipWeapon",
  /** Consume the potion/food in the bag slot at the given index. */
  UseItem: "useItem",
  /** Gather a mining node (short server-side cast; range-checked). */
  GatherNode: "gatherNode",
  /** Buy an item from the market stall (server-priced; range-checked). */
  BuyItem: "buyItem",
  /** Sell one item from a bag slot to the market stall. */
  SellItem: "sellItem",
} as const;

/** Server -> client (state itself syncs automatically; these are events). */
export const ServerMessage = {
  /** Transient combat feedback for VFX/floating numbers. */
  CombatEvent: "combatEvent",
  /** A drop landed in a player's bag; drives a pickup toast (killer-only client-side). */
  LootEvent: "lootEvent",
  /** The joining client's own session/entity id, sent once on join. */
  Welcome: "welcome",
} as const;

export type CombatActionState = "idle" | "attack" | "skill" | "hit" | "dying" | "dead";

export interface InputMessage {
  /** Client-monotonic sequence number (reserved for future reconciliation). */
  seq: number;
  /** Desired planar move direction in world space, each component in [-1, 1]. */
  moveX: number;
  moveZ: number;
  /** Facing yaw in radians (camera-relative aim), for orientation only. */
  yaw: number;
}

export interface SetTargetMessage {
  /** Target entity state id, or empty string to clear the target. */
  targetId: string;
  /** When true, selecting this target also starts auto-follow/basic attacks. */
  autoAttack?: boolean;
}

export interface SetAutoAttackMessage {
  enabled: boolean;
}

export interface UseSkillMessage {
  /** Hotbar slot 0-9 (keys 1-9,0). The server resolves the slot's skillId. */
  slot: number;
}

export interface ToggleWeaponMessage {
  equipped: boolean;
}

export interface EquipWeaponMessage {
  /** Catalog weapon id present in the player's bag. */
  itemId: string;
}

export interface UseItemMessage {
  /** Bag slot index of the consumable to use. */
  index: number;
}

export interface GatherNodeMessage {
  /** ResourceNodeState id in ZoneState.nodes. */
  nodeId: string;
}

export interface BuyItemMessage {
  /** Catalog item id; must be in the market stock and have a buyValue. */
  itemId: string;
}

export interface SellItemMessage {
  /** Bag slot index; one unit is sold at the item's sellValue. */
  index: number;
}

export interface CombatEventMessage {
  sourceId: string;
  targetId: string;
  /** Positive = damage dealt, negative = healing. */
  amount: number;
  kind: "hit" | "crit" | "heal" | "death" | "skill";
  actionId?: string;
  /** Milliseconds from this event to the intended visual impact. */
  impactDelayMs?: number;
}

export interface LootEventMessage {
  /** Bag owner (the killer). Clients show the toast only when this is their own id. */
  playerId: string;
  /** Catalog id of the dropped item. */
  itemId: string;
  /** Item rarity for toast tinting. */
  rarity: string;
}

export interface WelcomeMessage {
  /** The player's own entity id in ZoneState.players (equals sessionId). */
  selfId: string;
  runId: string;
  seed: number;
}
