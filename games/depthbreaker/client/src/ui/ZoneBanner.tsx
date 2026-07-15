// Soft level-band gate: a brief banner that names the area the player enters and
// warns only when they're genuinely under-levelled for it. Purely advisory — the
// server never blocks entry (ARPG style: the monsters simply out-level you).
// Polls the local position at 2 Hz and AUTO-HIDES a few seconds after you enter,
// so it never sits on top of enemy nameplates while you fight.

import { useEffect, useMemo, useState } from "react";
import { buildDungeon, type DungeonArea } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { localPlayerPos } from "../game/entityRefs";

const AREA_NAME: Record<number, string> = { 1: "Goblin Warrens", 2: "The Bonefields", 3: "Infernal Reach" };
const SHOW_MS = 4500; // fade the banner out this long after entering an area

export function ZoneBanner() {
  const snap = useZoneState();
  const areas = useMemo(() => buildDungeon(snap.seed, snap.depth).areas ?? [], [snap.seed, snap.depth]);
  // Areas ranked by band → each area's "floor" (the level below which it truly
  // outmatches you) is the PREVIOUS tier's band. The lowest area (the 1–10
  // starter) has floor 0, so a fresh character is never warned there.
  const ranked = useMemo(() => [...areas].sort((a, b) => a.bandLevel - b.bandLevel), [areas]);
  const [area, setArea] = useState<DungeonArea | null>(null);
  const [visible, setVisible] = useState(false);

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

  // Show on entering a new area, then auto-hide so nameplates stay readable.
  useEffect(() => {
    if (!area) { setVisible(false); return; }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [area]);

  if (!area || !visible) return null;
  const level = zoneStore.getSnapshot().self?.level ?? 1;
  const idx = ranked.findIndex((a) => a.id === area.id);
  const floor = idx > 0 ? ranked[idx - 1]!.bandLevel : 0;
  const under = level < floor;

  return (
    <div style={wrap}>
      <div style={{ ...title, color: under ? "#fca5a5" : "#e8c874" }}>{AREA_NAME[area.id] ?? `Area ${area.id}`}</div>
      <div style={sub}>
        Lv {floor > 0 ? floor : 1}–{area.bandLevel}
        {under && <span style={warn}> · enemies here outmatch you</span>}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: "absolute",
  top: 40,
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
