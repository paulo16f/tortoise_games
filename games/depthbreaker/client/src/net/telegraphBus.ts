// Imperative pub/sub for AoE telegraphs (boss/elite ground-slams), so the 3D
// Telegraphs component reacts per-event without React re-renders — same pattern
// as combatBus. room.ts emits here when a ServerMessage.Telegraph arrives.

import type { TelegraphMessage } from "@depthbreaker/protocol";

export type TelegraphListener = (msg: TelegraphMessage) => void;

const listeners = new Set<TelegraphListener>();

export const telegraphBus = {
  subscribe(fn: TelegraphListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(msg: TelegraphMessage): void {
    for (const fn of listeners) fn(msg);
  },
};
