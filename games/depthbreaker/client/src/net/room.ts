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
  type ResourceNodeView,
  type InputMessage,
  type SetAutoAttackMessage,
  type SetTargetMessage,
  type ToggleWeaponMessage,
  type EquipWeaponMessage,
  type UseItemMessage,
  type UseSkillMessage,
  type GatherNodeMessage,
  type CraftMessage,
  type BuyItemMessage,
  type SellItemMessage,
  type StashDepositMessage,
  type StashWithdrawMessage,
  type StashMessage,
  type ClaimDailyMessage,
  type DailiesMessage,
  type BuySkinMessage,
  type EquipSkinMessage,
  type SkinsMessage,
  type ChatMessage,
  type SpinnerMessage,
  type SpinResultMessage,
  type TelegraphMessage,
  type CombatEventMessage,
  type LootEventMessage,
  type WelcomeMessage,
} from "@depthbreaker/protocol";
import { combatBus } from "./combatBus";
import { telegraphBus } from "./telegraphBus";

export interface MapLike<V> {
  forEach(cb: (value: V, key: string) => void): void;
  get(id: string): V | undefined;
  readonly size: number;
}

export interface ZoneStateLike {
  players: MapLike<PlayerView>;
  enemies: MapLike<EnemyView>;
  nodes: MapLike<ResourceNodeView>;
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
  /** Per-skill discriminator for VFX/SFX/anim; "" when the source has no skill id. */
  skillId: string;
}

/** A transient "you looted X" notification for the local player. */
export interface LootToast {
  id: number;
  itemId: string;
  rarity: string;
  bornAt: number;
}

/** One world-chat line in the rolling client-side log. */
export interface ChatLine {
  id: number;
  from: string;
  text: string;
}

/** Free-spin availability, timestamped so the panel can count down locally. */
export interface SpinnerSnapshot {
  cooldownRemaining: number;
  /** performance.now() when this value arrived, for a smooth local countdown. */
  updatedAt: number;
}

/** The most recent spin result (drives the wheel animation), with a bump id. */
export interface SpinResultEvent extends SpinResultMessage {
  id: number;
}

export interface ZoneSnapshot {
  playerCount: number;
  enemyCount: number;
  nodeCount: number;
  depth: number;
  seed: number;
  self: PlayerView | null;
  target: PlayerView | EnemyView | null;
  roomId: string;
  combat: CombatFloater[];
  lootToasts: LootToast[];
  bossPortal: BossPortalView;
  /** The local player's persistent stash (targeted server message). */
  stash: StashMessage;
  /** The local player's daily quests + progress (targeted server message). */
  dailies: DailiesMessage;
  /** The local player's owned + equipped cosmetic skins (targeted server message). */
  skins: SkinsMessage;
  /** Rolling world-chat log (most recent last). */
  chat: ChatLine[];
  /** Free-spin availability for the local player. */
  spinner: SpinnerSnapshot;
  /** Latest spin result, or null before the first spin this session. */
  spinResult: SpinResultEvent | null;
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
  private lootSeq = 0;
  private lootToasts: LootToast[] = [];
  private stash: StashMessage = { items: [], slotCap: 24 };
  private dailies: DailiesMessage = { dateKey: "", quests: [] };
  private skins: SkinsMessage = { equipped: "", owned: [] };
  private chatSeq = 0;
  private chat: ChatLine[] = [];
  private spinner: SpinnerSnapshot = { cooldownRemaining: 0, updatedAt: 0 };
  private spinSeq = 0;
  private spinResult: SpinResultEvent | null = null;

  static emptySnapshot(): ZoneSnapshot {
    return {
      playerCount: 0,
      enemyCount: 0,
      nodeCount: 0,
      depth: 0,
      seed: 0,
      self: null,
      target: null,
      roomId: "",
      combat: [],
      lootToasts: [],
      bossPortal: { active: false, x: 0, z: 0, countdown: 0 },
      stash: { items: [], slotCap: 24 },
      dailies: { dateKey: "", quests: [] },
      skins: { equipped: "", owned: [] },
      chat: [],
      spinner: { cooldownRemaining: 0, updatedAt: 0 },
      spinResult: null,
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

  /** Dev-only: seed a mock snapshot for the canvas-free HUD preview (?hud). */
  __setMockSnapshot = (snap: ZoneSnapshot): void => {
    this.snapshot = snap;
    for (const fn of this.listeners) fn();
  };

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
        skillId: msg.skillId ?? "",
      };
      this.combat.push(floater);
      const cutoff = performance.now() - 2000;
      this.combat = this.combat.filter((c) => c.bornAt >= cutoff).slice(-24);
      combatBus.emit(floater);
      this.refresh();
    });

    room.onMessage(ServerMessage.LootEvent, (msg: LootEventMessage) => {
      // Server broadcasts to the room; only the killer shows the toast.
      if (msg.playerId !== this.selfId) return;
      this.lootToasts.push({ id: this.lootSeq++, itemId: msg.itemId, rarity: msg.rarity, bornAt: performance.now() });
      const cutoff = performance.now() - 2500;
      this.lootToasts = this.lootToasts.filter((t) => t.bornAt >= cutoff).slice(-6);
      this.refresh();
    });

    room.onMessage(ServerMessage.Stash, (msg: StashMessage) => {
      this.stash = msg;
      this.refresh();
    });

    room.onMessage(ServerMessage.Dailies, (msg: DailiesMessage) => {
      this.dailies = msg;
      this.refresh();
    });

    room.onMessage(ServerMessage.Skins, (msg: SkinsMessage) => {
      this.skins = msg;
      this.refresh();
    });

    room.onMessage(ServerMessage.Chat, (msg: ChatMessage) => {
      this.chat.push({ id: this.chatSeq++, from: msg.from ?? "?", text: msg.text });
      this.chat = this.chat.slice(-50); // keep the log bounded
      this.refresh();
    });

    room.onMessage(ServerMessage.Spinner, (msg: SpinnerMessage) => {
      this.spinner = { cooldownRemaining: msg.cooldownRemaining, updatedAt: performance.now() };
      this.refresh();
    });

    room.onMessage(ServerMessage.SpinResult, (msg: SpinResultMessage) => {
      this.spinResult = { ...msg, id: this.spinSeq++ };
      this.spinner = { cooldownRemaining: msg.cooldownRemaining, updatedAt: performance.now() };
      this.refresh();
    });

    room.onMessage(ServerMessage.Telegraph, (msg: TelegraphMessage) => {
      // 3D-only reaction; bypass React (no snapshot involvement).
      telegraphBus.emit(msg);
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
      nodeCount: st.nodes?.size ?? 0,
      depth: st.depth ?? 0,
      bossPortal: st.bossPortal ?? { active: false, x: 0, z: 0, countdown: 0 },
      seed: st.seed ?? 0,
      self,
      target,
      roomId: this.room?.roomId ?? "",
      combat: this.combat.slice(),
      lootToasts: this.lootToasts.slice(),
      stash: this.stash,
      dailies: this.dailies,
      skins: this.skins,
      chat: this.chat.slice(),
      spinner: this.spinner,
      spinResult: this.spinResult,
    };
    this.emit();
  }

  detach(): void {
    this.room = null;
    this.selfId = "";
    this.combat = [];
    this.lootToasts = [];
    this.stash = { items: [], slotCap: 24 };
    this.dailies = { dateKey: "", quests: [] };
    this.skins = { equipped: "", owned: [] };
    this.chat = [];
    this.spinner = { cooldownRemaining: 0, updatedAt: 0 };
    this.spinResult = null;
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

  sendGather(nodeId: string): void {
    const payload: GatherNodeMessage = { nodeId };
    this.room?.send(ClientMessage.GatherNode, payload);
  }

  sendCraft(recipeId: string): void {
    const payload: CraftMessage = { recipeId };
    this.room?.send(ClientMessage.Craft, payload);
  }

  sendBuy(itemId: string): void {
    const payload: BuyItemMessage = { itemId };
    this.room?.send(ClientMessage.BuyItem, payload);
  }

  sendSell(index: number): void {
    const payload: SellItemMessage = { index };
    this.room?.send(ClientMessage.SellItem, payload);
  }

  sendStashDeposit(index: number): void {
    const payload: StashDepositMessage = { index };
    this.room?.send(ClientMessage.StashDeposit, payload);
  }

  sendStashWithdraw(itemId: string): void {
    const payload: StashWithdrawMessage = { itemId };
    this.room?.send(ClientMessage.StashWithdraw, payload);
  }

  sendClaimDaily(questId: string): void {
    const payload: ClaimDailyMessage = { questId };
    this.room?.send(ClientMessage.ClaimDaily, payload);
  }

  sendBuySkin(skinId: string): void {
    const payload: BuySkinMessage = { skinId };
    this.room?.send(ClientMessage.BuySkin, payload);
  }

  sendEquipSkin(skinId: string): void {
    const payload: EquipSkinMessage = { skinId };
    this.room?.send(ClientMessage.EquipSkin, payload);
  }

  sendToggleWeapon(equipped: boolean): void {
    const payload: ToggleWeaponMessage = { equipped };
    this.room?.send(ClientMessage.ToggleWeapon, payload);
  }

  sendEquipWeapon(itemId: string): void {
    const payload: EquipWeaponMessage = { itemId };
    this.room?.send(ClientMessage.EquipWeapon, payload);
  }

  sendUseItem(index: number): void {
    const payload: UseItemMessage = { index };
    this.room?.send(ClientMessage.UseItem, payload);
  }

  sendChat(text: string): void {
    const payload: ChatMessage = { text };
    this.room?.send(ClientMessage.Chat, payload);
  }

  sendSpin(): void {
    this.room?.send(ClientMessage.Spin, {});
  }

  /** Ask the zone to re-pull wallet/stash/dailies/skins after a REST-side change. */
  sendRefreshPrivate(): void {
    this.room?.send(ClientMessage.RefreshPrivate, {});
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
