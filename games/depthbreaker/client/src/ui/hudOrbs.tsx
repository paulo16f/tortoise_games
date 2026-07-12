// Diablo-style stat globes for the HUD corners: a glass sphere that fills
// bottom-up, with a gold rim and a glossy highlight. Pure CSS (no sprites), so it
// scales crisply. Used for the Health orb (bottom-left) and the XP orb
// (bottom-right).

import type { CSSProperties, ReactNode } from "react";

export function StatOrb({
  frac,
  size = 116,
  fill,
  glow,
  big,
  small,
}: {
  frac: number;
  size?: number;
  /** CSS background for the liquid (a vertical gradient). */
  fill: string;
  /** Glow colour above the liquid surface. */
  glow: string;
  /** Large centre label (e.g. HP number or "Lv14"). */
  big: ReactNode;
  /** Small sub-label under it (e.g. "128/170"). */
  small?: ReactNode;
}) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* glass well + clipped liquid */}
      <div style={well}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${f * 100}%`,
            background: fill,
            boxShadow: `0 0 22px ${glow}, 0 -2px 6px ${glow} inset`,
            transition: "height 220ms ease",
          }}
        />
        {/* surface shimmer just above the liquid line */}
        {f > 0.02 && f < 0.99 && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${f * 100}%`, height: 3, background: "rgba(255,255,255,0.35)", filter: "blur(1px)" }} />
        )}
        {/* top-left gloss */}
        <div style={gloss} />
      </div>
      {/* gold rim */}
      <div style={rim} />
      {/* labels */}
      <div style={labels}>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, textShadow: "0 2px 3px #000" }}>{big}</div>
        {small != null && <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2, textShadow: "0 1px 2px #000" }}>{small}</div>}
      </div>
    </div>
  );
}

const well: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  overflow: "hidden",
  background: "radial-gradient(circle at 50% 32%, #171a22, #090a0e 72%)",
  boxShadow: "inset 0 0 26px rgba(0,0,0,0.85)",
};
const gloss: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "radial-gradient(circle at 36% 26%, rgba(255,255,255,0.28), transparent 42%)",
  pointerEvents: "none",
};
const rim: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  border: "3px solid #c9a54a",
  boxShadow: "0 0 0 2px #3a2f14, inset 0 0 10px rgba(0,0,0,0.7), 0 6px 20px rgba(0,0,0,0.55)",
  pointerEvents: "none",
};
const labels: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  color: "#f8fafc",
  fontFamily: "system-ui, sans-serif",
  pointerEvents: "none",
};
