// Plain read-only interfaces mirroring the Colyseus schema fields. The client
// uses these to type room.state (decoded via colyseus.js reflection) without
// depending on the Schema classes' internals. Keep in sync with schema.ts.

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
  alive: boolean;
}

export interface EnemyView {
  id: string;
  defId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  fsm: string;
  targetId: string;
  alive: boolean;
}
