// Colyseus connection + a tiny reactive store. Positions are read imperatively
// in useFrame for smoothness; React state only tracks coarse, throttled facts.

import { Client, Room } from "colyseus.js";
import {
  ClientMessage,
  ServerMessage,
  ZONE_ROOM,
  type ClassId,
  type PlayerView,
  type EnemyView,
  type BossPortalView,
  type InputMessage,
  type SetAutoAttackMessage,
  type SetTargetMessage,
  type ToggleWeaponMessage,
  type UseSkillMessage,
  type CombatEventMessage,
  type WelcomeMessage,
} from "@depthbreaker/protocol";
import { combatBus } from "./combatBus";

export interface MapLike<V> {
  forEach(cb: (value: V, key: string) => void): void;
  get(id: string): V | undefined;
  readonly size: number;
}

export interface ZoneStateLike {
  players: MapLike<PlayerView>;
  enemies: MapLike<EnemyView>;
  seed: number;
  depth: number;
  bossPortal: BossPortalView;
}

export interface ConnectOptions {
  url: string;
  ticket?: string;
  name: string;
  classId: ClassId;
}

export interface CombatFloater {
  id: number;
  sourceId: string;
  targetId: string;
  amount: number;
  kind: CombatEventMessage["kind"];
  actionId: string;
  bornAt: number;
  delayMs: number;
}

export interface ZoneSnapshot {
  playerCount: number;
  enemyCount: number;
  depth: number;
  seed: number;
  self: PlayerView | null;
  target: PlayerView | EnemyView | null;
  roomId: string;
  combat: CombatFloater[];
  bossPortal: BossPortalView;
}

type Listener = () => void;

class ZoneStore {
  room: Room | null = null;
  selfId = "";
  private listeners = new Set<Listener>();
  private snapshot: ZoneSnapshot = ZoneStore.emptySnapshot();
  private lastEmit = 0;
  private combatSeq = 0;
  private combat: CombatFloater[] = [];

  static emptySnapshot(): ZoneSnapshot {
    return {
      playerCount: 0,
      enemyCount: 0,
      depth: 0,
      seed: 0,
      self: null,
      target: null,
      roomId: "",
      combat: [],
      bossPortal: { active: false, x: 0, z: 0, countdown: 0 },
    };
  }

  get state(): ZoneStateLike | null {
    return (this.room?.state as unknown as ZoneStateLike) ?? null;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): ZoneSnapshot => this.snapshot;

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  attach(room: Room, selfId: string): void {
    this.room = room;
    this.selfId = selfId;

    room.onStateChange(() => {
      const now = performance.now();
      if (now - this.lastEmit < 100) return;
      this.lastEmit = now;
      this.refresh();
    });

    room.onMessage(ServerMessage.Welcome, (msg: WelcomeMessage) => {
      this.selfId = msg.selfId;
      this.refresh();
    });

    room.onMessage(ServerMessage.CombatEvent, (msg: CombatEventMessage) => {
      const floater: CombatFloater = {
        id: this.combatSeq++,
        sourceId: msg.sourceId,
        targetId: msg.targetId,
        amount: msg.amount,
        kind: msg.kind,
        actionId: msg.actionId ?? "",
        bornAt: performance.now(),
        delayMs: msg.impactDelayMs ?? 0,
      };
      this.combat.push(floater);
      const cutoff = performance.now() - 2000;
      this.combat = this.combat.filter((c) => c.bornAt >= cutoff).slice(-24);
      combatBus.emit(floater);
      this.refresh();
    });

    room.onLeave(() => this.detach());
    this.refresh();
  }

  private refresh(): void {
    const st = this.state;
    if (!st || !st.players || !st.enemies) {
      this.snapshot = ZoneStore.emptySnapshot();
      this.emit();
      return;
    }
    const self = st.players.get(this.selfId) ?? null;
    let target: PlayerView | EnemyView | null = null;
    if (self && self.targetId) {
      target = st.enemies.get(self.targetId) ?? st.players.get(self.targetId) ?? null;
    }
    this.snapshot = {
      playerCount: st.players.size,
      enemyCount: st.enemies.size,
      depth: st.depth ?? 0,
      bossPortal: st.bossPortal ?? { active: false, x: 0, z: 0, countdown: 0 },
      seed: st.seed ?? 0,
      self,
      target,
      roomId: this.room?.roomId ?? "",
      combat: this.combat.slice(),
    };
    this.emit();
  }

  detach(): void {
    this.room = null;
    this.selfId = "";
    this.combat = [];
    this.snapshot = ZoneStore.emptySnapshot();
    this.emit();
  }

  sendInput(msg: InputMessage): void {
    this.room?.send(ClientMessage.Input, msg);
  }

  sendTarget(targetId: string, autoAttack = false): void {
    const payload: SetTargetMessage = { targetId, autoAttack };
    this.room?.send(ClientMessage.SetTarget, payload);
  }

  sendAutoAttack(enabled: boolean): void {
    const payload: SetAutoAttackMessage = { enabled };
    this.room?.send(ClientMessage.SetAutoAttack, payload);
  }

  sendSkill(slot: number): void {
    const payload: UseSkillMessage = { slot };
    this.room?.send(ClientMessage.UseSkill, payload);
  }

  sendToggleWeapon(equipped: boolean): void {
    const payload: ToggleWeaponMessage = { equipped };
    this.room?.send(ClientMessage.ToggleWeapon, payload);
  }
}

export const zoneStore = new ZoneStore();

export async function connectToZone(opts: ConnectOptions): Promise<Room> {
  const client = new Client(opts.url);
  const joinOpts: Record<string, unknown> = { name: opts.name, classId: opts.classId };
  if (opts.ticket) joinOpts.ticket = opts.ticket;
  const room = await client.joinOrCreate(ZONE_ROOM, joinOpts);
  zoneStore.attach(room, room.sessionId);
  return room;
}

export function leaveZone(): void {
  const room = zoneStore.room;
  zoneStore.detach();
  room?.leave().catch(() => undefined);
}
