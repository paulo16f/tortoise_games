// Plain read-only interfaces mirroring the Colyseus schema fields. The client
// uses these to type room.state without depending on Schema internals.

import type { CombatActionState } from "./messages.js";

export interface PlayerView {
  id: string;
  accountId: string;
  characterId: string;
  name: string;
  classId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  level: number;
  runXp: number;
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
  skillQCooldown: number;
  skillECooldown: number;
  shieldSeconds: number;
  frostSeconds: number;
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
