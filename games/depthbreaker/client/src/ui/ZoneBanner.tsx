// Soft level-band gate: a top banner that names the area the player is in and
// warns when they're under-levelled for its band. Purely advisory — the server
// never blocks entry (ARPG style: the monsters simply out-level you). Polls the
// local position at 2 Hz (not per-frame) and only re-renders when the zone
// changes, so it's cheap.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildDungeon, type DungeonArea } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { localPlayerPos } from "../game/entityRefs";

const AREA_NAME: Record<number, string> = { 1: "Goblin Warrens", 2: "The Bonefields", 3: "Infernal Reach" };

export function ZoneBanner() {
  const snap = useZoneState();
  const areas = useMemo(() => buildDungeon(snap.seed, snap.depth).areas ?? [], [snap.seed, snap.depth]);
  const [area, setArea] = useState<DungeonArea | null>(null);
  const shownAt = useRef(0);

  useEffect(() => {
    if (!areas.length) return;
    const id = window.setInterval(() => {
      const px = localPlayerPos.x, pz = localPlayerPos.z;
      let cur: DungeonArea | null = null;
      let best = 42; // "in" an area when within ~42u of its centre
      for (const a of areas) {
        const d = Math.hypot(a.center.x - px, a.center.z - pz);
        if (d < best) { best = d; cur = a; }
      }
      setArea((prev) => (prev?.id === cur?.id ? prev : cur));
    }, 500);
    return () => window.clearInterval(id);
  }, [areas]);

  useEffect(() => {
    if (area) shownAt.current = performance.now();
  }, [area]);

  if (!area) return null;
  const level = zoneStore.getSnapshot().self?.level ?? 1;
  const under = level < area.bandLevel - 4;

  return (
    <div style={wrap}>
      <div style={{ ...title, color: under ? "#fca5a5" : "#e8c874" }}>{AREA_NAME[area.id] ?? `Area ${area.id}`}</div>
      <div style={sub}>
        Recommended Lv {area.bandLevel}
        {under && <span style={warn}> · enemies here outmatch you</span>}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: "absolute",
  top: 60,
  left: "50%",
  transform: "translateX(-50%)",
  textAlign: "center",
  pointerEvents: "none",
  fontFamily: "system-ui, sans-serif",
  textShadow: "0 2px 6px rgba(0,0,0,0.8)",
  animation: "zonebanner-in 300ms ease-out",
};
const title: React.CSSProperties = { fontSize: 26, fontWeight: 800, letterSpacing: 0.5 };
const sub: React.CSSProperties = { fontSize: 13, color: "#cbd5e1", marginTop: 2, fontWeight: 600 };
const warn: React.CSSProperties = { color: "#f87171" };
