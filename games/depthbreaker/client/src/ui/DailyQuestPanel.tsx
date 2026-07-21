// Daily quests panel (toggled by the dock icon or J). Shows today's three
// quests with progress bars; a Claim button lights up when complete. Quests +
// progress arrive via the targeted ServerMessage.Dailies; claiming credits
// gold server-side. Same external-store + drag-hook pattern as the others.

import { framedPanel, frameTitle } from "./frames";
import { useSyncExternalStore } from "react";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { useDraggablePanel } from "./useDraggablePanel";
import { PanelClose } from "./PanelClose";

let dailiesOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleDailies(): void {
  dailiesOpen = !dailiesOpen;
  emitOpen();
}
export function closeDailies(): void {
  if (!dailiesOpen) return;
  dailiesOpen = false;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
function useDailiesOpenInternal(): boolean {
  return useSyncExternalStore(subscribeOpen, () => dailiesOpen);
}
export const useDailiesOpen = useDailiesOpenInternal;

export function DailyQuestPanel() {
  const open = useDailiesOpenInternal();
  const snap = useZoneState();
  const { position, dragHandlers } = useDraggablePanel("dailies", () => ({ x: window.innerWidth - 300, y: 90 }));
  if (!open) return null;
  const quests = snap.dailies.quests;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 280,
        ...framedPanel,
        padding: 12,
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div {...dragHandlers} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, ...dragHandlers.style }}>
        <span style={frameTitle}>Daily Quests</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>resets daily</span>
          <PanelClose onClose={closeDailies} />
        </div>
      </div>

      {quests.length === 0 && (
        <div style={{ opacity: 0.55, fontSize: 12 }}>Sign in with an account to earn daily rewards.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {quests.map((q) => {
          const frac = q.target > 0 ? Math.min(1, q.progress / q.target) : 0;
          const complete = q.progress >= q.target;
          return (
            <div key={q.id} style={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{q.label}</span>
                <span style={{ color: "#fbbf24", fontSize: 12 }}>🪙 {q.goldReward}</span>
              </div>
              <div style={{ position: "relative", height: 8, background: "#1f2937", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
                <div style={{ width: `${frac * 100}%`, height: "100%", background: complete ? "#22c55e" : "#3b82f6" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ opacity: 0.7, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                  {Math.min(q.progress, q.target)} / {q.target}
                </span>
                <button
                  onClick={() => zoneStore.sendClaimDaily(q.id)}
                  disabled={!complete || q.claimed}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: q.claimed ? "#1f2937" : complete ? "#16a34a" : "#334155",
                    color: q.claimed ? "rgba(255,255,255,0.4)" : "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: complete && !q.claimed ? "pointer" : "default",
                  }}
                >
                  {q.claimed ? "Claimed" : "Claim"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
