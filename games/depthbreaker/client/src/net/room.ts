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
  type SetTargetMessage,
  type UseSkillMessage,
  type CombatEventMessage,
  type WelcomeMessage,
} from "@depthbreaker/protocol";
import { combatBus } from "./combatBus";
import { MAX_PROJECTILE_DELAY_MS, PROJECTILE_SPEED } from "../game/fx/fxConstants";

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
        bornAt: performance.now(),
        delayMs: this.projectileDelayMs(msg),
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

  private projectileDelayMs(msg: CombatEventMessage): number {
    if (msg.kind !== "hit" && msg.kind !== "crit" && msg.kind !== "skill") return 0;
    const st = this.state;
    const source = st?.players.get(msg.sourceId);
    if (!source || source.classId !== "mage" || msg.amount <= 0) return 0;
    const target = st?.enemies.get(msg.targetId) ?? st?.players.get(msg.targetId);
    if (!target) return 0;
    const dist = Math.hypot(target.x - source.x, target.z - source.z);
    return Math.min(MAX_PROJECTILE_DELAY_MS, (dist / PROJECTILE_SPEED) * 1000);
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

  sendTarget(targetId: string): void {
    const payload: SetTargetMessage = { targetId };
    this.room?.send(ClientMessage.SetTarget, payload);
  }

  sendSkill(slot: number): void {
    const payload: UseSkillMessage = { slot };
    this.room?.send(ClientMessage.UseSkill, payload);
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
