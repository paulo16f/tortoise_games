// React hooks over the zone store.

import { useSyncExternalStore } from "react";
import { zoneStore, type ZoneSnapshot } from "./room";

/** Re-renders on throttled state patches / combat events. */
export function useZoneState(): ZoneSnapshot {
  return useSyncExternalStore(zoneStore.subscribe, zoneStore.getSnapshot);
}

/** Access the raw store (room, imperative state reads, senders). */
export function useZoneStore(): typeof zoneStore {
  return zoneStore;
}
