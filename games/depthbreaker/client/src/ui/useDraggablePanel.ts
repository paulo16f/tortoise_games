// Click-and-drag positioning for the overlay panels (bag / skill book /
// market). The panel's header row spreads `dragHandlers`; the whole panel is
// positioned with left/top from `position`. Positions persist per panel key in
// localStorage and are clamped so a panel can never be dragged (or restored)
// fully off-screen.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PanelPosition {
  x: number;
  y: number;
}

function storageKey(key: string): string {
  return `db_panel_${key}`;
}

function clamp(pos: PanelPosition): PanelPosition {
  // Keep at least a grabbable strip inside the viewport.
  return {
    x: Math.min(Math.max(pos.x, 8 - 200), window.innerWidth - 60),
    y: Math.min(Math.max(pos.y, 8), window.innerHeight - 40),
  };
}

function load(key: string, fallback: PanelPosition): PanelPosition {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PanelPosition;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return fallback;
    return clamp(parsed);
  } catch {
    return fallback;
  }
}

export function useDraggablePanel(key: string, defaultPos: () => PanelPosition) {
  const [position, setPosition] = useState<PanelPosition>(() => load(key, clamp(defaultPos())));
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  // Re-clamp on window resize so a panel positioned for a larger window (or a
  // restored position) can never end up stranded off-screen with no grab strip.
  useEffect(() => {
    const onResize = () => setPosition((p) => clamp(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Left button only; don't hijack clicks on buttons inside the header.
      if (e.button !== 0 || (e.target instanceof HTMLElement && e.target.closest("button"))) return;
      e.preventDefault();
      drag.current = { pointerId: e.pointerId, offsetX: e.clientX - position.x, offsetY: e.clientY - position.y };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is an optimization (drag outside the header); never fatal */
      }
    },
    [position.x, position.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    setPosition(clamp({ x: e.clientX - d.offsetX, y: e.clientY - d.offsetY }));
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      drag.current = null;
      // Persist FIRST — releasePointerCapture can throw for pointers that were
      // never captured, and the save must not depend on capture succeeding.
      // Compute the final spot from the event (state updates may still be
      // batched at this point).
      try {
        const final = clamp({ x: e.clientX - d.offsetX, y: e.clientY - d.offsetY });
        localStorage.setItem(storageKey(key), JSON.stringify(final));
      } catch {
        /* storage disabled — position just won't persist */
      }
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* never captured — nothing to release */
      }
    },
    [key],
  );

  return {
    position,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      style: { cursor: "move", touchAction: "none" } as const,
    },
  };
}
