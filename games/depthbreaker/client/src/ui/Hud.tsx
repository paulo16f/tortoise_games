// HTML overlay HUD (position:absolute over the canvas). Reads throttled zone
// state. Shows local player HP/level/XP, current target, connection status,
// and a controls legend.

import { useEffect, useRef, useState } from "react";
import { xpToNext, POTION_COOLDOWN_SECONDS } from "@depthbreaker/sim";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import type { EnemyView, PlayerView } from "@depthbreaker/protocol";

/** Human-readable enemy AI state for the target frame. */
function enemyStatus(fsm: string): string {
  switch (fsm) {
    case "combat":
      return "attacking";
    case "aggro":
      return "chasing";
    case "leash":
      return "retreating";
    default:
      return "idle";
  }
}

/** Resolve who an enemy is fighting: "you" for the local player, else a name. */
function targetOfTargetName(targetId: string, selfId: string | undefined): string {
  if (targetId === selfId) return "you";
  return zoneStore.state?.players.get(targetId)?.name ?? "someone";
}

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

/**
 * Healing potion slot with a radial cooldown sweep. The server replicates
 * potionCooldown at ~10 Hz; between snapshots we count down locally from the
 * last replicated value so the sweep animates smoothly.
 */
function PotionSlot({ cooldown }: { cooldown: number }) {
  const seed = useRef({ value: cooldown, at: performance.now() });
  const [display, setDisplay] = useState(cooldown);

  useEffect(() => {
    seed.current = { value: cooldown, at: performance.now() };
  }, [cooldown]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const s = seed.current;
      const value = Math.max(0, s.value - (performance.now() - s.at) / 1000);
      // Only re-render when the sweep moves noticeably.
      setDisplay((prev) => (Math.abs(prev - value) > 0.05 ? value : prev));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const frac = Math.max(0, Math.min(1, display / POTION_COOLDOWN_SECONDS));
  const ready = display <= 0;

  return (
    <div
      style={{
        position: "relative",
        width: 48,
        height: 48,
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${ready ? "rgba(34,197,94,0.6)" : "rgba(255,255,255,0.15)"}`,
        background: "rgba(11,13,18,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 800,
        color: "#f8fafc",
      }}
    >
      POT
      {!ready && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `conic-gradient(rgba(0,0,0,0.7) ${frac * 360}deg, transparent 0deg)`,
            }}
          />
          <span
            style={{
              position: "absolute",
              fontSize: 14,
              fontWeight: 700,
              color: "#f8fafc",
              textShadow: "0 1px 2px #000",
            }}
          >
            {Math.ceil(display)}
          </span>
        </>
      )}
      <span
        style={{
          position: "absolute",
          right: 3,
          bottom: 1,
          fontSize: 10,
          opacity: 0.8,
          color: "#e6e9ef",
        }}
      >
        2
      </span>
    </div>
  );
}

function SkillSlot({ hotkey, label, cooldown, max, active = false }: { hotkey: string; label: string; cooldown: number; max: number; active?: boolean }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, cooldown / max)) : 0;
  const ready = cooldown <= 0;
  return (
    <div
      style={{
        position: "relative",
        width: 52,
        height: 52,
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${active ? "rgba(147,197,253,0.9)" : ready ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)"}`,
        background: active ? "rgba(14,116,144,0.55)" : "rgba(11,13,18,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 800,
        color: "#f8fafc",
      }}
    >
      {label}
      {!ready && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `conic-gradient(rgba(0,0,0,0.68) ${frac * 360}deg, transparent 0deg)`,
            }}
          />
          <span style={{ position: "absolute", fontSize: 14, textShadow: "0 1px 2px #000" }}>{Math.ceil(cooldown)}</span>
        </>
      )}
      <span style={{ position: "absolute", right: 4, bottom: 2, fontSize: 10, opacity: 0.8 }}>{hotkey}</span>
    </div>
  );
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
          {self?.name ?? "â€”"}{" "}
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

      {/* Target panel (top-center) while targeting a living entity. */}
      {target && target.alive && (
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
          {isEnemy(target) && (
            <div style={{ opacity: 0.7, marginTop: 5, fontSize: 12 }}>
              {enemyStatus(target.fsm)}
              {target.targetId && (
                <>
                  {" | "}â†’ {targetOfTargetName(target.targetId, self?.id)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hotbar (bottom-center). */}
      {self && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 8,
          }}
        >
          <SkillSlot
            hotkey="Q"
            label={self.classId === "mage" ? "FIRE" : "SHIELD"}
            cooldown={self.skillQCooldown ?? 0}
            max={self.classId === "mage" ? 6 : 10}
            active={(self.shieldSeconds ?? 0) > 0}
          />
          <SkillSlot
            hotkey="E"
            label={self.classId === "mage" ? "FROST" : "SLASH"}
            cooldown={self.skillECooldown ?? 0}
            max={self.classId === "mage" ? 14 : 7}
            active={(self.frostSeconds ?? 0) > 0}
          />
          <PotionSlot cooldown={self.potionCooldown ?? 0} />
        </div>
      )}
      {/* Connection + legend (top-left). */}
      <div style={{ position: "absolute", top: 16, left: 16, ...panelStyle }}>
        <div style={{ opacity: 0.85 }}>
          room <b>{snap.roomId || "..."}</b> | players {snap.playerCount} | enemies {snap.enemyCount} | depth {snap.depth}
          {snap.bossPortal.active && <> | boss in {Math.ceil(snap.bossPortal.countdown)}s</>}
        </div>
        <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
          WASD move | click/Tab target | right-drag pan | scroll zoom | Q/E skills | 2 potion
        </div>
      </div>
    </div>
  );
}
