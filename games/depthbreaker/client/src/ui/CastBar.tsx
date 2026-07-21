// Cast progress bar above the hotbar (currently only mining uses it). Started
// optimistically when the client sends a cast intent; the fill is local (the
// server doesn't stream cast progress), and a combatBus hit/crit on the local
// player cancels it with a brief red "Interrupted" flash — mirroring the
// server, where being hit invalidates the gather action.

import { useEffect, useState, useSyncExternalStore } from "react";
import { combatBus } from "../net/combatBus";
import { zoneStore } from "../net/room";

interface CastState {
  label: string;
  startedAt: number;
  durationMs: number;
  interrupted: boolean;
}

let cast: CastState | null = null;
const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}

export function startCastBar(label: string, durationSeconds: number): void {
  cast = { label, startedAt: performance.now(), durationMs: durationSeconds * 1000, interrupted: false };
  emit();
}

function interruptCastBar(): void {
  if (!cast || cast.interrupted) return;
  cast = { ...cast, interrupted: true, startedAt: performance.now(), durationMs: 450 };
  emit();
}

function useCast(): CastState | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => cast,
  );
}

export function CastBar() {
  const current = useCast();
  const [, force] = useState(0);

  // Animate the fill + auto-expire while a cast is up.
  useEffect(() => {
    if (!current) return;
    let raf = 0;
    const loop = () => {
      if (cast && performance.now() - cast.startedAt >= cast.durationMs) {
        cast = null;
        emit();
        return;
      }
      force((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [current]);

  // A hit on the local player interrupts the cast (matches the server rule).
  useEffect(
    () =>
      combatBus.subscribe((f) => {
        if ((f.kind === "hit" || f.kind === "crit") && f.targetId === zoneStore.selfId) interruptCastBar();
      }),
    [],
  );

  if (!current) return null;
  const progress = Math.min(1, (performance.now() - current.startedAt) / current.durationMs);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 118,
        left: "50%",
        transform: "translateX(-50%)",
        width: 220,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          height: 16,
          background: "rgba(11,13,18,0.85)",
          border: `1px solid ${current.interrupted ? "rgba(239,68,68,0.8)" : "rgba(255,255,255,0.18)"}`,
          borderRadius: 5,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(current.interrupted ? 1 : progress) * 100}%`,
            height: "100%",
            background: current.interrupted ? "#7f1d1d" : "#b45309",
          }}
        />
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 700,
            color: "#f8fafc",
            textShadow: "0 1px 2px #000",
          }}
        >
          {current.interrupted ? "Interrupted" : current.label}
        </span>
      </div>
    </div>
  );
}
