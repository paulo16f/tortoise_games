// Free daily spinner (Kintara-style gold faucet). Toggled by the dock 🎡 icon or
// G. The server owns the cooldown + prize roll (ZoneRoom.handleSpin →
// /internal/spinner); this panel just shows the wheel, a live countdown, and the
// last prize. The wheel lands on a segment matching the server's result — since
// several segments can share a prize, it picks any matching one (cosmetic only).

import { framedPanel, frameTitle } from "./frames";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SPINNER_PRIZES, SPINNER_SEGMENTS } from "@depthbreaker/sim";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { useDraggablePanel } from "./useDraggablePanel";
import { itemName } from "./itemDisplay";
import { PanelClose } from "./PanelClose";

let spinnerOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleSpinner(): void {
  spinnerOpen = !spinnerOpen;
  emitOpen();
}
export function closeSpinner(): void {
  if (!spinnerOpen) return;
  spinnerOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
export function useSpinnerOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => spinnerOpen);
}

const SEG_DEG = 360 / SPINNER_SEGMENTS;

/** Build the conic-gradient slices; the gold jackpot segment stands out. */
function wheelBackground(): string {
  const stops = SPINNER_PRIZES.map((prize, i) => {
    const color = prize.kind === "gold" ? "#f59e0b" : i % 2 === 0 ? "#1e3a5f" : "#274b73";
    return `${color} ${i * SEG_DEG}deg ${(i + 1) * SEG_DEG}deg`;
  });
  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

/** First segment index whose prize matches the server's result (for the landing). */
function segmentForResult(isGold: boolean, itemId: string): number {
  const idx = SPINNER_PRIZES.findIndex((p) =>
    isGold ? p.kind === "gold" : p.kind === "item" && p.itemId === itemId,
  );
  return idx < 0 ? 0 : idx;
}

function formatCooldown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function SpinnerPanel() {
  const open = useSpinnerOpen();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("spinner", () => ({
    x: Math.max(16, window.innerWidth / 2 - 130),
    y: 90,
  }));

  const [remaining, setRemaining] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const lastResultId = useRef<number | null>(null);

  // Local 1s countdown from the last server-reported cooldown baseline.
  useEffect(() => {
    const tick = () => {
      const { cooldownRemaining, updatedAt } = snap.spinner;
      const elapsed = updatedAt ? (performance.now() - updatedAt) / 1000 : 0;
      setRemaining(Math.max(0, cooldownRemaining - elapsed));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [snap.spinner]);

  // Animate the wheel when a fresh spin result arrives.
  useEffect(() => {
    const result = snap.spinResult;
    if (!result || result.id === lastResultId.current) return;
    lastResultId.current = result.id;
    const seg = segmentForResult(result.isGold, result.itemId);
    // Land the chosen segment's center under the top pointer, after 5 full turns.
    const landing = 360 - (seg + 0.5) * SEG_DEG;
    setSpinning(true);
    setRotation((prev) => {
      const base = prev - (prev % 360); // normalize, then add turns + landing
      return base + 360 * 5 + landing;
    });
    const done = window.setTimeout(() => setSpinning(false), 3600);
    return () => window.clearTimeout(done);
  }, [snap.spinResult]);

  if (!open) return null;
  const ready = remaining <= 0;
  const result = snap.spinResult;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 260,
        ...framedPanel,
        padding: 12,
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div {...dragHandlers} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, ...dragHandlers.style }}>
        <span style={frameTitle}>Fortune Wheel</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>free daily</span>
          <PanelClose onClose={closeSpinner} />
        </div>
      </div>

      <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto 12px" }}>
        {/* Top pointer. */}
        <div
          style={{
            position: "absolute",
            top: -4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "9px solid transparent",
            borderRight: "9px solid transparent",
            borderTop: "14px solid #fbbf24",
            zIndex: 2,
            filter: "drop-shadow(0 1px 2px #000)",
          }}
        />
        <div
          style={{
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: wheelBackground(),
            border: "4px solid #0b0d12",
            boxShadow: "0 0 0 2px rgba(251,191,36,0.5), inset 0 0 24px rgba(0,0,0,0.5)",
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? "transform 3.4s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
          }}
        />
        {/* Hub. */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 34,
            height: 34,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: "#0b0d12",
            border: "2px solid #fbbf24",
            display: "grid",
            placeItems: "center",
            fontSize: 16,
          }}
        >
          🎡
        </div>
      </div>

      {result && !spinning && (
        <div style={{ textAlign: "center", marginBottom: 10, color: "#4ade80", fontWeight: 700, fontSize: 13 }}>
          Won: {result.isGold ? `🪙 ${result.count} gold` : `${itemName(result.itemId)}${result.count > 1 ? ` ×${result.count}` : ""}`}
        </div>
      )}

      <button
        onClick={() => zoneStore.sendSpin()}
        disabled={!ready || spinning}
        style={{
          width: "100%",
          padding: "10px 0",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.14)",
          background: ready && !spinning ? "#1d4ed8" : "#1f2937",
          color: ready && !spinning ? "#fff" : "rgba(255,255,255,0.5)",
          fontSize: 14,
          fontWeight: 700,
          cursor: ready && !spinning ? "pointer" : "default",
        }}
      >
        {spinning ? "Spinning…" : ready ? "Spin (free)" : `Next spin in ${formatCooldown(remaining)}`}
      </button>
      <div style={{ opacity: 0.5, fontSize: 11, textAlign: "center", marginTop: 8 }}>
        One free spin every 24 hours.
      </div>
    </div>
  );
}
