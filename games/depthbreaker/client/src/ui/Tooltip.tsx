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
  /**
   * The DOM element the tooltip belongs to. We key show/hide on this (a stable
   * node React reuses across re-renders) rather than the `render` closure — the
   * closure is recreated on every parent re-render (panels re-render at the 20Hz
   * snapshot rate), so an identity check on it would fail and the tooltip would
   * never clear on mouse-out. That was the "popup stuck on screen" bug.
   */
  owner: Element;
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
  onMouseLeave: (e: React.MouseEvent) => void;
} {
  return {
    onMouseEnter: (e) => setTip({ render, x: e.clientX, y: e.clientY, owner: e.currentTarget }),
    onMouseMove: (e) => {
      // Follow the cursor + refresh the (re-created) render fn while still over
      // the same element.
      if (tip?.owner === e.currentTarget) setTip({ render, x: e.clientX, y: e.clientY, owner: e.currentTarget });
    },
    onMouseLeave: (e) => {
      if (tip?.owner === e.currentTarget) setTip(null);
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
  // Safety net: if the owning element was unmounted while hovered (a panel
  // closed via Esc/×, an item row was removed) no mouse-leave fires, so hide the
  // stale card. This layer re-renders with its parent, so the check runs often;
  // the stale tip is simply overwritten by the next hover.
  if (!current.owner.isConnected) return null;
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
