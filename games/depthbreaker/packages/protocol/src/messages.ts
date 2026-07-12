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
  /** Gather a mining/fishing node (short server-side cast; range-checked). */
  GatherNode: "gatherNode",
  /** Cook a recipe at the cooking station (server-validated bag math). */
  Craft: "craft",
  /** Buy an item from the market stall (server-priced; range-checked). */
  BuyItem: "buyItem",
  /** Sell one item from a bag slot to the market stall. */
  SellItem: "sellItem",
  /** Deposit one unit from a bag slot into the persistent stash (at the stall). */
  StashDeposit: "stashDeposit",
  /** Withdraw one unit of an item from the persistent stash into the bag. */
  StashWithdraw: "stashWithdraw",
  /** Claim the reward for a completed daily quest. */
  ClaimDaily: "claimDaily",
  /** Buy a cosmetic skin with gold (at the market stall). */
  BuySkin: "buySkin",
  /** Equip an owned cosmetic skin ("" = class default). */
  EquipSkin: "equipSkin",
  /** Ask the zone to re-pull wallet/stash/dailies/skins after an out-of-band
   *  REST change (e.g. a P2P marketplace buy) so the in-game HUD is current. */
  RefreshPrivate: "refreshPrivate",
  /** Send a world-chat message (broadcast to the room, rate-limited). */
  Chat: "chat",
  /** Take the free daily spin (server-rolled prize). */
  Spin: "spin",
} as const;

/** Server -> client (state itself syncs automatically; these are events). */
export const ServerMessage = {
  /** Transient combat feedback for VFX/floating numbers. */
  CombatEvent: "combatEvent",
  /** A drop landed in a player's bag; drives a pickup toast (killer-only client-side). */
  LootEvent: "lootEvent",
  /** The joining client's own session/entity id, sent once on join. */
  Welcome: "welcome",
  /** The player's OWN persistent stash contents (targeted send, not room state). */
  Stash: "stash",
  /** The player's OWN daily quests + progress (targeted send). */
  Dailies: "dailies",
  /** The player's OWN owned + equipped cosmetic skins (targeted send). */
  Skins: "skins",
  /** A world-chat line broadcast to the room. */
  Chat: "chat",
  /** Result of a spin (targeted): the prize + next-free-spin time. */
  SpinResult: "spinResult",
  /** The player's OWN spinner state (targeted): whether a free spin is ready. */
  Spinner: "spinner",
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

export interface CraftMessage {
  /** Cooking recipe id (validated server-side against COOKING_RECIPES). */
  recipeId: string;
}

export interface BuyItemMessage {
  /** Catalog item id; must be in the market stock and have a buyValue. */
  itemId: string;
}

export interface SellItemMessage {
  /** Bag slot index; one unit is sold at the item's sellValue. */
  index: number;
}

export interface StashDepositMessage {
  /** Bag slot index; one unit moves bag -> stash. */
  index: number;
}

export interface StashWithdrawMessage {
  /** Catalog item id; one unit moves stash -> bag. */
  itemId: string;
}

/** Payload of ServerMessage.Stash — the recipient's own stash snapshot. */
export interface StashMessage {
  items: { itemId: string; count: number }[];
  slotCap: number;
}

export interface ClaimDailyMessage {
  /** Daily quest id to claim (must be complete + unclaimed server-side). */
  questId: string;
}

export interface BuySkinMessage {
  skinId: string;
}

export interface EquipSkinMessage {
  /** Skin id to equip, or "" for the class default. */
  skinId: string;
}

/** Payload of ServerMessage.Skins — the recipient's owned + equipped skins. */
export interface SkinsMessage {
  equipped: string;
  owned: string[];
}

export interface ChatMessage {
  /** Chat body (client sends this; server echoes it with `from` populated). */
  text: string;
  /** Sender display name — set by the server on broadcast, ignored on send. */
  from?: string;
}

/** Payload of ServerMessage.Spinner — whether the free spin is available. */
export interface SpinnerMessage {
  /** Seconds until the next free spin (0 = ready now). */
  cooldownRemaining: number;
}

/** Payload of ServerMessage.SpinResult — the prize a spin awarded. */
export interface SpinResultMessage {
  itemId: string;
  count: number;
  /** True when the prize was gold (credited to the wallet, not the bag). */
  isGold: boolean;
  cooldownRemaining: number;
}

/** One daily quest with the player's progress. */
export interface DailyQuestView {
  id: string;
  kind: "gather" | "kill" | "depth" | "cook";
  label: string;
  target: number;
  subject: string;
  goldReward: number;
  xpReward: number;
  progress: number;
  claimed: boolean;
}

/** Payload of ServerMessage.Dailies — the recipient's own daily quests. */
export interface DailiesMessage {
  dateKey: string;
  quests: DailyQuestView[];
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
