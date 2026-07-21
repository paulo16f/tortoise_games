// Tiny pub/sub for client-detected world events (level-up today; anything the
// snapshot watcher spots tomorrow). Same React-free pattern as combatBus so FX
// components can react per-event without re-renders.

type LevelUpListener = (level: number) => void;
const levelUpListeners = new Set<LevelUpListener>();

export function onLevelUp(fn: LevelUpListener): () => void {
  levelUpListeners.add(fn);
  return () => levelUpListeners.delete(fn);
}

export function emitLevelUp(level: number): void {
  for (const fn of levelUpListeners) fn(level);
}
