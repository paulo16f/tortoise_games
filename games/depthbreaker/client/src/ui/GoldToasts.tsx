// Gold gain/loss toasts ("+6 🪙" / "−20 🪙"), stacked beside the loot toasts.
// Purely client-side: watches the synced self.gold across snapshots and toasts
// the delta — covers selling, buying, and any future gold source without new
// protocol. The first non-null gold sync (wallet hydration on join) is skipped
// so logging in doesn't toast your whole balance.

import { useEffect, useRef, useState } from "react";
import { useZoneState } from "../net/useZone";

interface GoldToast {
  id: number;
  delta: number;
  bornAt: number;
}

const TOAST_TTL_MS = 2200;
let seq = 0;

export function GoldToasts() {
  const snap = useZoneState();
  const prevGold = useRef<number | null>(null);
  const [toasts, setToasts] = useState<GoldToast[]>([]);
  const [, force] = useState(0);

  const gold = snap.self?.gold ?? null;
  useEffect(() => {
    if (gold === null) {
      prevGold.current = null; // left the zone; re-hydrate silently next join
      return;
    }
    if (prevGold.current === null) {
      prevGold.current = gold; // first sync = wallet hydration, not a gain
      return;
    }
    const delta = gold - prevGold.current;
    prevGold.current = gold;
    if (delta === 0) return;
    setToasts((prev) => [...prev.slice(-4), { id: seq++, delta, bornAt: performance.now() }]);
  }, [gold]);

  // Age toasts out (same ticking pattern as LootToasts).
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setInterval(() => {
      force((n) => n + 1);
      setToasts((prev) => prev.filter((t) => performance.now() - t.bornAt < TOAST_TTL_MS));
    }, 200);
    return () => window.clearInterval(timer);
  }, [toasts.length]);

  if (toasts.length === 0) return null;
  const now = performance.now();

  return (
    <div
      style={{
        position: "absolute",
        bottom: 84,
        left: "calc(50% + 150px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {toasts.map((t) => {
        const age = now - t.bornAt;
        const opacity = Math.max(0, 1 - age / TOAST_TTL_MS);
        const gained = t.delta > 0;
        return (
          <div
            key={t.id}
            style={{
              opacity,
              transform: `translateY(${-10 * (1 - opacity)}px)`,
              background: "rgba(11,13,18,0.82)",
              border: `1px solid ${gained ? "rgba(74,222,128,0.6)" : "rgba(248,113,113,0.6)"}`,
              borderRadius: 6,
              padding: "3px 9px",
              fontSize: 13,
              fontWeight: 700,
              color: gained ? "#4ade80" : "#f87171",
              textShadow: "0 1px 2px #000",
            }}
          >
            {gained ? "+" : "−"}
            {Math.abs(t.delta)} 🪙
          </div>
        );
      })}
    </div>
  );
}
