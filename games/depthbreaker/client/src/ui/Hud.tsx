// HTML overlay HUD (position:absolute over the canvas). Reads throttled zone
// state. Shows local player HP/level/XP, current target, connection status,
// and a controls legend.

import { useEffect, useRef, useState } from "react";
import { xpToNext, GCD_SECONDS } from "@depthbreaker/sim";
import { skillDef } from "@depthbreaker/protocol";
import { useZoneState } from "../net/useZone";
import { zoneStore } from "../net/room";
import { itemName, itemInitials } from "./itemDisplay";
import { swingTimerState } from "./swingTimer";
import { tooltipHandlers } from "./Tooltip";
import { StatOrb } from "./hudOrbs";
import { iconForSkill } from "./hudIcons";
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
    <div style={{ position: "relative", width: 200, height, background: bg, borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)" }}>
      <div style={{ width: `${frac * 100}%`, height: "100%", background: color, transition: "width 120ms linear" }} />
    </div>
  );
}

function isEnemy(t: PlayerView | EnemyView | null): t is EnemyView {
  return !!t && "defId" in t;
}

function SkillSlot({
  hotkey,
  label,
  icon,
  cooldown,
  max,
  gcd = 0,
  active = false,
  locked = false,
  tooltip,
}: {
  hotkey: string;
  label: string;
  /** Optional icon sprite; falls back to the text label. */
  icon?: string;
  cooldown: number;
  max: number;
  /** Shared global-cooldown seconds remaining; drives a shallow sweep when the skill's own cooldown is clear. */
  gcd?: number;
  active?: boolean;
  /** True while the skill's learnLevel is above the character's level. */
  locked?: boolean;
  /** Rich hover card content (rendered by the singleton TooltipLayer). */
  tooltip?: () => React.ReactNode;
}) {
  const frac = max > 0 ? Math.max(0, Math.min(1, cooldown / max)) : 0;
  // The skill's own cooldown always outlasts the ~1s GCD, so only paint the GCD
  // sweep when the skill itself is off cooldown but the global cooldown is up.
  const onGcdOnly = cooldown <= 0 && gcd > 0;
  const sweepFrac = cooldown > 0 ? frac : onGcdOnly ? Math.max(0, Math.min(1, gcd / GCD_SECONDS)) : 0;
  const sweepColor = cooldown > 0 ? "rgba(0,0,0,0.68)" : "rgba(96,165,250,0.5)";
  const showSweep = !locked && (cooldown > 0 || onGcdOnly);
  const ready = !locked && cooldown <= 0 && gcd <= 0;
  return (
    <div
      {...(tooltip ? tooltipHandlers(tooltip) : {})}
      style={{
        // Clean Diablo-style action slot: dark inset well, gold rim that brightens
        // when active/ready. Icon-ready (falls back to the text label).
        position: "relative",
        width: 50,
        height: 50,
        borderRadius: 6,
        overflow: "hidden",
        border: `1px solid ${active ? "#e8c874" : ready ? "rgba(201,165,74,0.55)" : "rgba(255,255,255,0.12)"}`,
        background: active
          ? "linear-gradient(180deg, rgba(201,165,74,0.22), rgba(10,11,15,0.92))"
          : "linear-gradient(180deg, rgba(30,34,44,0.9), rgba(8,9,13,0.95))",
        boxShadow: active ? "0 0 10px rgba(201,165,74,0.5), inset 0 0 8px rgba(201,165,74,0.22)" : "inset 0 1px 0 rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        filter: locked ? "grayscale(0.7) brightness(0.6)" : "none",
        // The HUD root is pointerEvents:none; slots opt back in for tooltips.
        pointerEvents: "auto",
      }}
    >
      {icon ? (
        <img src={icon} alt="" draggable={false} style={{ width: "86%", height: "86%", objectFit: "contain" }} />
      ) : (
        <span style={{ fontSize: 12, fontWeight: 800, color: locked ? "rgba(148,163,184,0.6)" : "#f1e9d0" }}>{label}</span>
      )}
      {showSweep && (
        <div style={{ position: "absolute", inset: 0, background: `conic-gradient(${sweepColor} ${sweepFrac * 360}deg, transparent 0deg)`, pointerEvents: "none" }} />
      )}
      {cooldown > 0 && (
        <span style={{ position: "absolute", fontSize: 15, fontWeight: 800, textShadow: "0 1px 2px #000" }}>{Math.ceil(cooldown)}</span>
      )}
      {locked && <span style={{ position: "absolute", left: 4, top: 2, fontSize: 10, opacity: 0.85, zIndex: 2 }}>🔒</span>}
      <span style={{ position: "absolute", right: 4, bottom: 1, fontSize: 10, opacity: 0.8, zIndex: 2, textShadow: "0 1px 2px #000" }}>{hotkey}</span>
    </div>
  );
}

/**
 * Auto-attack swing-timer bar. The server replicates swingCooldown at ~10 Hz;
 * between snapshots we count down locally from the last replicated value so the
 * fill animates smoothly (same technique as PotionSlot). The pure
 * `swingTimerState` derives visibility/fill from the interpolated value.
 */
function SwingBar({
  autoAttack,
  swingCooldown,
  swingInterval,
  targetAlive,
}: {
  autoAttack: boolean;
  swingCooldown: number;
  swingInterval: number;
  targetAlive: boolean;
}) {
  const seed = useRef({ value: swingCooldown, at: performance.now() });
  const [display, setDisplay] = useState(swingCooldown);

  useEffect(() => {
    seed.current = { value: swingCooldown, at: performance.now() };
  }, [swingCooldown]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const s = seed.current;
      const value = Math.max(0, s.value - (performance.now() - s.at) / 1000);
      setDisplay((prev) => (Math.abs(prev - value) > 0.02 ? value : prev));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const state = swingTimerState({ autoAttack, swingCooldown: display, swingInterval }, { alive: targetAlive });
  if (!state.visible) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 6 }}>
      <span style={{ width: 40, opacity: 0.7, fontSize: 11, textAlign: "right" }}>swing</span>
      <div
        style={{
          position: "relative",
          width: 172,
          height: 8,
          background: "#1f2937",
          borderRadius: 4,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div
          style={{
            width: `${state.frac * 100}%`,
            height: "100%",
            background: state.ready ? "#fbbf24" : "#f59e0b",
            transition: "width 60ms linear",
          }}
        />
      </div>
    </div>
  );
}
const panelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(18,20,27,0.82), rgba(8,9,13,0.86))",
  border: "1px solid rgba(201,165,74,0.35)",
  borderRadius: 8,
  padding: "10px 12px",
  backdropFilter: "blur(4px)",
  fontSize: 13,
  lineHeight: 1.4,
  color: "#e8e2d0",
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
      {/* Health orb (bottom-left, Diablo globe) */}
      <div style={{ position: "absolute", left: 22, bottom: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 12.5, color: "#e2e8f0", textShadow: "0 1px 2px #000", pointerEvents: "none", whiteSpace: "nowrap" }}>
          {self?.name ?? "—"} <span style={{ opacity: 0.6 }}>· {self?.classId ?? "?"}</span>
        </div>
        <StatOrb
          frac={self ? (self.hp ?? 0) / Math.max(1, self.maxHp ?? 1) : 0}
          fill="linear-gradient(0deg, #7f1d1d, #ef4444 85%)"
          glow="rgba(239,68,68,0.6)"
          frame="/ui/synty/orb_left.png"
          big={Math.round(self?.hp ?? 0)}
          small={`${Math.round(self?.hp ?? 0)} / ${self?.maxHp ?? 0}`}
        />
      </div>

      {/* Experience orb + gold (bottom-right) */}
      <div style={{ position: "absolute", right: 22, bottom: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 12.5, color: "#fbbf24", fontWeight: 700, fontVariantNumeric: "tabular-nums", textShadow: "0 1px 2px #000", pointerEvents: "none" }}>
          🪙 {self?.gold ?? 0}
        </div>
        <StatOrb
          frac={need > 0 ? xpIntoLevel / need : 1}
          fill="linear-gradient(0deg, #1e3a8a, #60a5fa 85%)"
          glow="rgba(96,165,250,0.55)"
          frame="/ui/synty/orb_right.png"
          big={`Lv${level}`}
          small={need > 0 ? `${xpIntoLevel}/${need}` : "MAX"}
        />
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
            {self?.autoAttack && self.targetId === target.id ? "auto attack on | " : ""}
            {enemyStatus(target.fsm)}
              {target.targetId && (
                <>
                  {" | "}→ {targetOfTargetName(target.targetId, self?.id)}
                </>
              )}
            </div>
          )}
          {isEnemy(target) && self && self.targetId === target.id && (
            <SwingBar
              autoAttack={self.autoAttack}
              swingCooldown={self.swingCooldown ?? 0}
              swingInterval={self.swingInterval ?? 0}
              targetAlive={target.alive}
            />
          )}
        </div>
      )}

      {/* Action bar (bottom-center): the skill tray, 10 slots from the hotbar. */}
      {self && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "18px 54px",
            pointerEvents: "auto",
          }}
        >
          {/* Ornate Synty action-bar frame behind the slot row. */}
          <img src="/ui/synty/actionbar.png" alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
          <div style={{ display: "flex", gap: 7, position: "relative", zIndex: 1 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const slot = self.hotbar?.[i];
            const def = slot?.skillId ? skillDef(slot.skillId) : undefined;
            const hotkey = i === 9 ? "0" : String(i + 1);
            if (!slot || !def) {
              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    width: 50,
                    height: 50,
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(8,9,13,0.55)",
                    boxShadow: "inset 0 0 8px rgba(0,0,0,0.5)",
                  }}
                >
                  <span style={{ position: "absolute", right: 4, bottom: 2, fontSize: 10, opacity: 0.35, color: "#e6e9ef" }}>
                    {hotkey}
                  </span>
                </div>
              );
            }
            const isAuto = def.id === "basic_attack";
            const active =
              (isAuto && self.autoAttack) ||
              (def.id === "shield_wall" && (self.shieldSeconds ?? 0) > 0) ||
              (def.id === "frost_nova" && (self.frostSeconds ?? 0) > 0) ||
              (def.id === "blessing" && (self.ampSeconds ?? 0) > 0);
            const lockedNow = !slot.unlocked;
            return (
              <SkillSlot
                key={i}
                hotkey={hotkey}
                label={isAuto && self.autoAttack ? "AUTO" : def.label}
                icon={iconForSkill(def.id)}
                cooldown={slot.cooldownRemaining}
                max={def.cooldown || 1}
                gcd={def.offGcd ? 0 : self.gcdRemaining ?? 0}
                active={active}
                locked={lockedNow}
                tooltip={() => (
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                      {def.name}
                      <span style={{ opacity: 0.55, fontWeight: 400 }}> — key {hotkey}</span>
                    </div>
                    <div style={{ opacity: 0.8 }}>{def.description}</div>
                    <div style={{ opacity: 0.6, marginTop: 4 }}>
                      {def.cooldown > 0 ? `${def.cooldown}s cooldown` : "no cooldown"}
                      {def.offGcd ? " · off global cooldown" : ""}
                    </div>
                    {lockedNow && (
                      <div style={{ color: "#fbbf24", marginTop: 4 }}>Unlocks at Lv {def.learnLevel}</div>
                    )}
                  </div>
                )}
              />
            );
          })}
          </div>
        </div>
      )}
      {/* Status chip + collapsible controls (top-left). */}
      <div style={{ position: "absolute", top: 14, left: 14, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ ...panelStyle, display: "flex", gap: 12, alignItems: "center", fontSize: 12.5, padding: "7px 13px" }}>
          <span style={{ color: "#c9a54a", fontWeight: 700 }}>Depth {snap.depth}</span>
          <span style={{ opacity: 0.8 }}>👤 {snap.playerCount}</span>
          <span style={{ color: "#e88b8b" }}>☠ {snap.enemyCount}</span>
          {snap.bossPortal.active && <span style={{ color: "#fbbf24", fontWeight: 700 }}>⚑ boss {Math.ceil(snap.bossPortal.countdown)}s</span>}
        </div>
        <details style={{ ...panelStyle, fontSize: 12, padding: "6px 11px", pointerEvents: "auto", maxWidth: 300 }}>
          <summary style={{ cursor: "pointer", opacity: 0.8, userSelect: "none" }}>Controls</summary>
          <div style={{ opacity: 0.78, marginTop: 6, lineHeight: 1.6 }}>
            <b>WASD</b>/click — move · click mob — attack · click node — gather · <b>Tab</b> — target · <b>1–0</b> — skills · <b>B</b> bag · <b>K</b> skills · <b>M</b> market · <b>T</b> trade · <b>N</b> bank · <b>F</b> cook · <b>J</b> quests · <b>G</b> wheel · <b>C</b> chat · <b>V</b> weapon
          </div>
        </details>
      </div>
    </div>
  );
}
