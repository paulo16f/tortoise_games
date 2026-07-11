// Singleton styled tooltip. Any element spreads tooltipHandlers(() => <card/>)
// and the one TooltipLayer (mounted last in GameCanvas) renders the content in
// a fixed card near the cursor, clamped to the viewport. Module-level external
// store, same pattern as the panels — no context/prop drilling, works from any
// overlay. pointerEvents: none so it never steals hovers.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

interface TooltipState {
  render: () => ReactNode;
  x: number;
  y: number;
}

let tip: TooltipState | null = null;
const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}
function setTip(next: TooltipState | null): void {
  tip = next;
  emit();
}

/** Spread onto any DOM element to give it a styled tooltip card. */
export function tooltipHandlers(render: () => ReactNode): {
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
} {
  return {
    onMouseEnter: (e) => setTip({ render, x: e.clientX, y: e.clientY }),
    onMouseMove: (e) => {
      if (tip?.render === render) setTip({ render, x: e.clientX, y: e.clientY });
    },
    onMouseLeave: () => {
      if (tip?.render === render) setTip(null);
    },
  };
}

function useTip(): TooltipState | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => tip,
  );
}

const CARD_MAX_WIDTH = 260;

export function TooltipLayer() {
  const current = useTip();
  if (!current) return null;
  // Offset from the cursor, clamped so the card never leaves the viewport.
  const pad = 14;
  const left = Math.min(current.x + pad, window.innerWidth - CARD_MAX_WIDTH - 8);
  const top = Math.min(current.y + pad, window.innerHeight - 120);
  const style: CSSProperties = {
    position: "fixed",
    left,
    top,
    maxWidth: CARD_MAX_WIDTH,
    background: "rgba(11,13,18,0.94)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#e6e9ef",
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    lineHeight: 1.45,
    pointerEvents: "none",
    zIndex: 1000,
    boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
  };
  return <div style={style}>{current.render()}</div>;
}
