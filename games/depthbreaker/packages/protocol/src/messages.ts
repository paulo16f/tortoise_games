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
  /** Use a skill slot. 0/2 are current class skills, 1 is potion legacy. */
  UseSkill: "useSkill",
  /** Equip or unequip the currently available class weapon. */
  ToggleWeapon: "toggleWeapon",
} as const;

/** Server -> client (state itself syncs automatically; these are events). */
export const ServerMessage = {
  /** Transient combat feedback for VFX/floating numbers. */
  CombatEvent: "combatEvent",
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
  /** Skill slot: 0 = first class skill, 2 = second class skill, 1 = potion legacy. */
  slot: number;
}

export interface ToggleWeaponMessage {
  equipped: boolean;
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

export interface WelcomeMessage {
  /** The player's own entity id in ZoneState.players (equals sessionId). */
  selfId: string;
  runId: string;
  seed: number;
}
