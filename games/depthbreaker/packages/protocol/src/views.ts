// Plain read-only interfaces mirroring the Colyseus schema fields. The client
// uses these to type room.state without depending on Schema internals.

import type { CombatActionState } from "./messages.js";

export interface ItemSlotView {
  itemId: string;
  count: number;
  rarity: string;
  /** Remaining uses/durability for tools + weapons; -1 = not applicable. */
  uses: number;
}

export interface SkillSlotView {
  skillId: string;
  cooldownRemaining: number;
  unlocked: boolean;
}

export interface PlayerView {
  id: string;
  accountId: string;
  characterId: string;
  name: string;
  classId: string;
  skinId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  level: number;
  runXp: number;
  gold: number;
  targetId: string;
  autoAttack: boolean;
  weaponId: string;
  alive: boolean;
  actionState: CombatActionState;
  actionStartedAt: number;
  actionEndsAt: number;
  actionTargetId: string;
  actionId: string;
  potionCooldown: number;
  gcdRemaining: number;
  swingCooldown: number;
  swingInterval: number;
  shieldSeconds: number;
  frostSeconds: number;
  ampSeconds: number;
  /** Fixed-length bag; ArraySchema at runtime, read-only array-like here. */
  inventory: ReadonlyArray<ItemSlotView>;
  /** Fixed 10-slot hotbar; ArraySchema at runtime, read-only array-like here. */
  hotbar: ReadonlyArray<SkillSlotView>;
}

export interface EnemyView {
  id: string;
  defId: string;
  rank: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  fsm: string;
  targetId: string;
  alive: boolean;
  actionState: CombatActionState;
  actionStartedAt: number;
  actionEndsAt: number;
  actionTargetId: string;
  actionId: string;
}

export interface BossPortalView {
  active: boolean;
  x: number;
  z: number;
  countdown: number;
}

export interface ResourceNodeView {
  id: string;
  kind: string;
  x: number;
  z: number;
  depleted: boolean;
}
