// Always-on minimap (top-right): the dungeon layout drawn once from the same
// deterministic buildDungeon(seed, depth) the server simulates, with live
// entity dots painted over it at ~8Hz straight from the raw room state
// (zoneStore.state — the imperative path, same philosophy as combatBus, so a
// busy fight never re-renders React for dot movement).

import { useEffect, useMemo, useRef } from "react";
import { buildDungeon } from "@depthbreaker/protocol";
import { zoneStore } from "../net/room";
import { useZoneState } from "../net/useZone";

const SIZE = 172; // css pixels (square)
const PAD = 6; // world-units margin around the layout

export function Minimap() {
  const snap = useZoneState();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Layout + projection, rebuilt only when the map itself changes.
  const layout = useMemo(() => {
    const dungeon = buildDungeon(snap.seed, snap.depth);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const r of dungeon.walkable) {
      minX = Math.min(minX, r.minX); minZ = Math.min(minZ, r.minZ);
      maxX = Math.max(maxX, r.maxX); maxZ = Math.max(maxZ, r.maxZ);
    }
    const scale = SIZE / Math.max(maxX - minX + PAD * 2, maxZ - minZ + PAD * 2);
    const ox = (SIZE - (maxX - minX) * scale) / 2 - minX * scale;
    const oz = (SIZE - (maxZ - minZ) * scale) / 2 - minZ * scale;
    const px = (x: number) => x * scale + ox;
    // Flip Z: world +Z is "south" on the top-down camera, but canvas Y grows
    // downward — so the minimap read upside-down. Reflect Z around the map's
    // Z span to align the minimap with the on-screen view.
    const pz = (z: number) => (minZ + maxZ - z) * scale + oz;

    // The static base (walkable floor + stall/portal landmarks), drawn once.
    const base = document.createElement("canvas");
    base.width = base.height = SIZE * 2; // 2x for crispness
    const g = base.getContext("2d")!;
    g.scale(2, 2);
    g.fillStyle = "rgba(148,163,184,0.28)";
    // pz is Z-flipped, so maxZ is the top edge on screen.
    for (const r of dungeon.walkable) g.fillRect(px(r.minX), pz(r.maxZ), (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
    // Market stall landmark (gold diamond).
    g.fillStyle = "#e8c874";
    const sx = px(dungeon.marketStall.x), sz = pz(dungeon.marketStall.z);
    g.beginPath(); g.moveTo(sx, sz - 3); g.lineTo(sx + 3, sz); g.lineTo(sx, sz + 3); g.lineTo(sx - 3, sz); g.fill();
    return { base, px, pz };
  }, [snap.seed, snap.depth]);

  // Live dots at 8Hz from the raw room state — cheap, React-free.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { base, px, pz } = layout;
    const dot = (x: number, z: number, color: string, r = 2) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px(x), pz(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(base, 0, 0, SIZE, SIZE);
      const st = zoneStore.state;
      // Colyseus hydrates the schema maps asynchronously after attach — every
      // collection is optional until the first patch arrives.
      if (!st?.players || !st.enemies || !st.nodes) return;
      const selfId = zoneStore.getSnapshot().self?.id;
      st.nodes.forEach((n) => dot(n.x, n.z, "rgba(94,234,212,0.8)", 1.6));
      st.enemies.forEach((e) => {
        if (!e.alive) return;
        if (e.rank === "boss") dot(e.x, e.z, "#c084fc", 3.4);
        else dot(e.x, e.z, e.rank === "elite" ? "#fb923c" : "#ef4444", 2);
      });
      st.players.forEach((p) => {
        if (!p.alive) return;
        if (p.id === selfId) {
          dot(p.x, p.z, "#fde68a", 3);
          ctx.strokeStyle = "rgba(253,230,138,0.9)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px(p.x), pz(p.z), 4.6, 0, Math.PI * 2);
          ctx.stroke();
        } else dot(p.x, p.z, "#4ade80", 2.4);
      });
      const portal = st.bossPortal;
      if (portal?.active) {
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px(portal.x), pz(portal.z), 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    draw();
    const timer = window.setInterval(draw, 125);
    return () => window.clearInterval(timer);
  }, [layout]);

  return (
    <div style={wrap}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ width: SIZE, height: SIZE, display: "block" }} />
      <div style={depthChip}>Depth {snap.depth}</div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  // Top-right corner per the layout wireframe; the dock tray hangs below it.
  position: "absolute",
  top: 16,
  right: 16,
  width: SIZE,
  height: SIZE,
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid rgba(201,165,74,0.4)",
  background: "linear-gradient(180deg, rgba(12,14,19,0.88), rgba(6,7,10,0.9))",
  boxShadow: "0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
  pointerEvents: "none",
};

const depthChip: React.CSSProperties = {
  position: "absolute",
  left: 6,
  bottom: 4,
  fontSize: 10,
  fontWeight: 700,
  color: "#e8c874",
  fontFamily: "system-ui, sans-serif",
  textShadow: "0 1px 2px #000",
};
