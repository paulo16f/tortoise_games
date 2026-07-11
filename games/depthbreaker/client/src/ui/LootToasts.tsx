// Transient "Looted X" notifications for the local player, stacked above the
// hotbar. Reads the killer-filtered loot toasts off the zone snapshot; each
// entry fades out over its lifetime and is dropped once older than TOAST_TTL_MS.

import { useEffect, useState } from "react";
import { useZoneState } from "../net/useZone";
import { rarityColor, itemName } from "./itemDisplay";

const TOAST_TTL_MS = 2500;

export function LootToasts() {
  const snap = useZoneState();
  // Tick so toasts age out and fade even when no other state change re-renders us.
  const [, force] = useState(0);
  useEffect(() => {
    if (snap.lootToasts.length === 0) return;
    const timer = window.setInterval(() => force((n) => n + 1), 200);
    return () => window.clearInterval(timer);
  }, [snap.lootToasts.length]);

  const now = performance.now();
  const visible = snap.lootToasts.filter((t) => now - t.bornAt < TOAST_TTL_MS);
  if (visible.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 84,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {visible.map((t) => {
        const name = itemName(t.itemId);
        const age = now - t.bornAt;
        const opacity = Math.max(0, 1 - age / TOAST_TTL_MS);
        return (
          <div
            key={t.id}
            style={{
              opacity,
              transform: `translateY(${-8 * (1 - opacity)}px)`,
              background: "rgba(11,13,18,0.82)",
              border: `1px solid ${rarityColor(t.rarity)}`,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 13,
              fontWeight: 700,
              color: rarityColor(t.rarity),
              textShadow: "0 1px 2px #000",
            }}
          >
            Looted {name}
          </div>
        );
      })}
    </div>
  );
}
