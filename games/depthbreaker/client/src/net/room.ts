// Colyseus connection + a tiny reactive store. Positions are read imperatively
// in useFrame for smoothness; React state only tracks coarse, throttled facts
// (player/enemy counts, local player stats, target) so the HUD re-renders.

import { Client, Room } from "colyseus.js";
import {
  ClientMessage,
  ServerMessage,
  ZONE_ROOM,
  type ClassId,
  type PlayerView,
  type EnemyView,
  type InputMessage,
  type SetTargetMessage,
  type UseSkillMessage,
  type CombatEventMessage,
  type WelcomeMessage,
} from "@depthbreaker/protocol";

/**
 * Minimal structural view of the decoded Colyseus state. room.state.players and
 * room.state.enemies are MapSchema instances at runtime — we only rely on the
 * MapSchema surface (forEach/get/size) plus the scalar top-level fields.
 */
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
}

export interface ConnectOptions {
  url: string;
  ticket?: string;
  name: string;
  classId: ClassId;
}

/** A floating combat number spawned from a ServerMessage.CombatEvent. */
export interface CombatFloater {
  id: number;
  sourceId: string;
  targetId: string;
  amount: number;
  kind: CombatEventMessage["kind"];
  bornAt: number;
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
}

type Listener = () => void;

/**
 * Module singleton store around one Colyseus Room. useSyncExternalStore reads a
 * cached immutable snapshot; the store is refreshed on state change (throttled)
 * and on combat events.
 */
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
      // Throttle HUD refresh to ~10 Hz; per-frame reads happen in useFrame.
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
      this.combat.push({
        id: this.combatSeq++,
        sourceId: msg.sourceId,
        targetId: msg.targetId,
        amount: msg.amount,
        kind: msg.kind,
        bornAt: performance.now(),
      });
      // Keep only the last ~24 floaters and drop ones older than 1.5s.
      const cutoff = performance.now() - 1500;
      this.combat = this.combat.filter((c) => c.bornAt >= cutoff).slice(-24);
      this.refresh();
    });

    room.onLeave(() => {
      this.detach();
    });

    this.refresh();
  }

  private refresh(): void {
    const st = this.state;
    // On join, room.state exists but its MapSchema children may not be decoded
    // until the first state patch arrives — treat that as an empty zone.
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

  // --- outbound messages -------------------------------------------------
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

/**
 * Connect to the "zone" room. Passes a ticket if provided (dev servers accept
 * ticketless joins). Resolves once joined and the store is attached.
 */
export async function connectToZone(opts: ConnectOptions): Promise<Room> {
  const client = new Client(opts.url);
  const joinOpts: Record<string, unknown> = {
    name: opts.name,
    classId: opts.classId,
  };
  if (opts.ticket) joinOpts.ticket = opts.ticket;

  const room = await client.joinOrCreate(ZONE_ROOM, joinOpts);
  // sessionId is the player's own entity id until Welcome confirms it.
  zoneStore.attach(room, room.sessionId);
  return room;
}

export function leaveZone(): void {
  const room = zoneStore.room;
  zoneStore.detach();
  room?.leave().catch(() => undefined);
}
