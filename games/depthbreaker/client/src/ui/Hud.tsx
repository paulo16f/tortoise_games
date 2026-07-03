// HTML overlay HUD (position:absolute over the canvas). Reads throttled zone
// state. Shows local player HP/level/XP, current target, connection status,
// and a controls legend.

import { xpToNext } from "@depthbreaker/sim";
import { useZoneState } from "../net/useZone";
import type { EnemyView, PlayerView } from "@depthbreaker/protocol";

function Bar({
  value,
  max,
  color,
  bg = "#1f2937",
  height = 14,
}: {
  value: number;
  max: number;
  color: string;
  bg?: string;
  height?: number;
}) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      style={{
        position: "relative",
        width: 220,
        height,
        background: bg,
        borderRadius: 4,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      <div
        style={{
          width: `${frac * 100}%`,
          height: "100%",
          background: color,
          transition: "width 120ms linear",
        }}
      />
    </div>
  );
}

function isEnemy(t: PlayerView | EnemyView | null): t is EnemyView {
  return !!t && "defId" in t;
}

const panelStyle: React.CSSProperties = {
  background: "rgba(11,13,18,0.72)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 8,
  padding: "10px 12px",
  backdropFilter: "blur(4px)",
  fontSize: 13,
  lineHeight: 1.4,
  pointerEvents: "none",
};

export function Hud() {
  const snap = useZoneState();
  const self = snap.self;
  const target = snap.target;

  const level = self?.level ?? 1;
  const need = xpToNext(level);
  const runXp = self?.runXp ?? 0;
  // runXp is total run xp; approximate progress within the current level.
  const xpIntoLevel = need > 0 ? runXp % need : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        color: "#e6e9ef",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
      }}
    >
      {/* Local player panel (bottom-left). */}
      <div style={{ position: "absolute", left: 16, bottom: 16, ...panelStyle }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {self?.name ?? "—"}{" "}
          <span style={{ opacity: 0.7, fontWeight: 400 }}>
            ({self?.classId ?? "?"})
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 28, opacity: 0.75 }}>HP</span>
          <Bar value={self?.hp ?? 0} max={self?.maxHp ?? 1} color="#22c55e" />
          <span style={{ opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(self?.hp ?? 0)}/{self?.maxHp ?? 0}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, opacity: 0.75 }}>Lv{level}</span>
          <Bar value={xpIntoLevel} max={need || 1} color="#3b82f6" height={10} />
          <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
            {need > 0 ? `${xpIntoLevel}/${need}` : "MAX"}
          </span>
        </div>
      </div>

      {/* Target panel (top-center) when targeting. */}
      {target && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            ...panelStyle,
            textAlign: "center",
            minWidth: 220,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {isEnemy(target)
              ? `Enemy: ${target.defId || "unknown"}`
              : `Player: ${target.name}`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <Bar value={target.hp} max={target.maxHp || 1} color="#ef4444" />
            <span style={{ opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
              {Math.round(target.hp)}/{target.maxHp}
            </span>
          </div>
        </div>
      )}

      {/* Connection + legend (top-left). */}
      <div style={{ position: "absolute", top: 16, left: 16, ...panelStyle }}>
        <div style={{ opacity: 0.85 }}>
          room <b>{snap.roomId || "…"}</b> · players {snap.playerCount} · enemies{" "}
          {snap.enemyCount} · depth {snap.depth}
        </div>
        <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
          WASD move · click enemy to attack · right-drag look · scroll zoom · 1/2 skills
        </div>
      </div>
    </div>
  );
}
