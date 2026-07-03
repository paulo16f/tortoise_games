// Client <-> server message contract. Colyseus messages are addressed by a
// string type; these constants + payload interfaces keep both ends in sync.

/** Client -> server. */
export const ClientMessage = {
  /** Held-movement sample; the server is authoritative over resulting position. */
  Input: "input",
  /** Request to target an entity (player or enemy) by its state id. */
  SetTarget: "setTarget",
  /** Use skill slot 0 or 1 on the current target. */
  UseSkill: "useSkill",
} as const;

/** Server -> client (state itself syncs automatically; these are events). */
export const ServerMessage = {
  /** Transient combat feedback for VFX/floating numbers. */
  CombatEvent: "combatEvent",
  /** The joining client's own session/entity id, sent once on join. */
  Welcome: "welcome",
} as const;

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
}

export interface UseSkillMessage {
  /** Skill slot: 0 or 1. */
  slot: number;
}

export interface CombatEventMessage {
  sourceId: string;
  targetId: string;
  /** Positive = damage dealt, negative = healing. */
  amount: number;
  kind: "hit" | "crit" | "heal" | "death";
}

export interface WelcomeMessage {
  /** The player's own entity id in ZoneState.players (equals sessionId). */
  selfId: string;
  runId: string;
  seed: number;
}
