// Skill book panel (toggled with K). Pure reference UI: lists the class kit
// from the shared skill table with unlock levels; rows above the character's
// level render locked ("unlocks at Lv N"). Skills auto-unlock by level — there
// is no learn action to click. Same external-store pattern as InventoryPanel
// so the window keydown in useControls can toggle it without prop drilling.

import { useSyncExternalStore } from "react";
import { classKit, type ClassId, type SkillDef } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";

let bookOpen = false;
const openListeners = new Set<() => void>();
function emitOpen(): void {
  for (const fn of openListeners) fn();
}
export function toggleSkillBook(): void {
  bookOpen = !bookOpen;
  emitOpen();
}
function subscribeOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
function useBookOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => bookOpen);
}
/** Read-only subscription for other UI (e.g. the panel dock highlight). */
export const useSkillBookOpen = useBookOpen;

/** Hotbar slot index -> the keyboard key that fires it. */
function slotKeyLabel(slot: number): string {
  return slot === 9 ? "0" : String(slot + 1);
}

function SkillRow({ def, level }: { def: SkillDef; level: number }) {
  const unlocked = def.learnLevel <= level;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: unlocked ? "rgba(15,23,42,0.9)" : "rgba(11,13,18,0.55)",
        border: `1px solid ${unlocked ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}`,
        opacity: unlocked ? 1 : 0.55,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 800,
          background: "rgba(11,13,18,0.85)",
          border: "1px solid rgba(255,255,255,0.15)",
          flexShrink: 0,
        }}
      >
        {def.label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {def.name}
          <span style={{ opacity: 0.55, fontWeight: 400, fontSize: 12 }}> — key {slotKeyLabel(def.slot)}</span>
        </div>
        <div style={{ opacity: 0.75, fontSize: 12 }}>{def.description}</div>
      </div>
      <div style={{ fontSize: 12, flexShrink: 0, textAlign: "right" }}>
        {unlocked ? (
          <span style={{ color: "#4ade80" }}>Lv {def.learnLevel} ✓</span>
        ) : (
          <span style={{ color: "#fbbf24" }}>unlocks at Lv {def.learnLevel}</span>
        )}
      </div>
    </div>
  );
}

export function SkillBookPanel() {
  const open = useBookOpen();
  const snap = useZoneState();
  if (!open || !snap.self) return null;
  const level = snap.self.level;
  const kit = classKit(snap.self.classId as ClassId);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: 380,
        maxHeight: "70vh",
        overflowY: "auto",
        background: "rgba(11,13,18,0.88)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: 12,
        backdropFilter: "blur(4px)",
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>
          Skill Book <span style={{ opacity: 0.6, fontWeight: 400 }}>({snap.self.classId} — Lv {level})</span>
        </b>
        <span style={{ opacity: 0.6, fontSize: 12 }}>K to close</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {kit.map((def) => (
          <SkillRow key={def.id} def={def} level={level} />
        ))}
      </div>
    </div>
  );
}
