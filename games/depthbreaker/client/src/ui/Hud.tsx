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

function SkillSlot({
  hotkey,
  label,
  cooldown,
  max,
  gcd = 0,
  active = false,
  locked = false,
  tooltip,
}: {
  hotkey: string;
  label: string;
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
        color: locked ? "rgba(148,163,184,0.45)" : "#f8fafc",
        // The HUD root is pointerEvents:none; slots opt back in for tooltips.
        pointerEvents: "auto",
      }}
    >
      {label}
      {locked && (
        <span style={{ position: "absolute", left: 4, top: 2, fontSize: 10, opacity: 0.8 }}>🔒</span>
      )}
      {showSweep && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `conic-gradient(${sweepColor} ${sweepFrac * 360}deg, transparent 0deg)`,
            }}
          />
          {cooldown > 0 && (
            <span style={{ position: "absolute", fontSize: 14, textShadow: "0 1px 2px #000" }}>{Math.ceil(cooldown)}</span>
          )}
        </>
      )}
      <span style={{ position: "absolute", right: 4, bottom: 2, fontSize: 10, opacity: 0.8 }}>{hotkey}</span>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontWeight: 600 }}>
            {self?.name ?? "—"}{" "}
            <span style={{ opacity: 0.7, fontWeight: 400 }}>({self?.classId ?? "?"})</span>
          </span>
          <span style={{ color: "#fbbf24", fontWeight: 700, fontVariantNumeric: "tabular-nums", marginLeft: 12 }}>
            🪙 {self?.gold ?? 0}
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div
            style={{
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(15,23,42,0.86)",
              fontSize: 18,
            }}
            title="Equipped weapon"
          >
            {self?.weaponId ? itemInitials(self.weaponId) : "--"}
          </div>
          <div>
            <div style={{ opacity: 0.65, fontSize: 11 }}>Weapon</div>
            <div style={{ fontWeight: 700 }}>{self?.weaponId ? itemName(self.weaponId) : "Unequipped"}</div>
          </div>
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

      {/* Hotbar (bottom-center): 10 slots driven by the synced hotbar array. */}
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
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    border: "1px dashed rgba(255,255,255,0.10)",
                    background: "rgba(11,13,18,0.4)",
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
              (def.id === "frost_nova" && (self.frostSeconds ?? 0) > 0);
            const lockedNow = !slot.unlocked;
            return (
              <SkillSlot
                key={i}
                hotkey={hotkey}
                label={isAuto && self.autoAttack ? "AUTO" : def.label}
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
      )}
      {/* Connection + legend (top-left). */}
      <div style={{ position: "absolute", top: 16, left: 16, ...panelStyle }}>
        <div style={{ opacity: 0.85 }}>
          room <b>{snap.roomId || "..."}</b> | players {snap.playerCount} | enemies {snap.enemyCount} | depth {snap.depth}
          {snap.bossPortal.active && <> | boss in {Math.ceil(snap.bossPortal.countdown)}s</>}
        </div>
        <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
          WASD/click move | click mob auto-attack | click node gather | Tab target | 1-0 skills | K skills | B bag | M market | T trade | N bank | F cook | J quests | G wheel | Enter/C chat | V weapon
        </div>
      </div>
    </div>
  );
}
