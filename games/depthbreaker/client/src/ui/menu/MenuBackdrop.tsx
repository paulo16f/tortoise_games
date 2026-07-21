// Atmospheric full-screen backdrop shared by the login + character screens: a
// deep dungeon gradient, a vignette, a warm glow from below (like torchlight
// off-frame), and a scatter of slowly-rising embers. Pure CSS/DOM — no WebGL —
// so it's cheap and always renders even before the 3D preview loads. Sits behind
// the menu content (zIndex 0; content should sit at zIndex 1+).

import { useMemo } from "react";
import { MENU } from "./menuTheme";

const EMBER_COUNT = 22;

export function MenuBackdrop() {
  // Deterministic-ish scatter computed once per mount (index-seeded, no RNG dep).
  const embers = useMemo(
    () =>
      Array.from({ length: EMBER_COUNT }, (_, i) => {
        const left = (i * 137.5) % 100; // golden-angle spread across the width
        const size = 1.5 + ((i * 7) % 5);
        const delay = (i * 0.9) % 14;
        const duration = 10 + ((i * 3) % 9);
        const drift = ((i % 5) - 2) * 24;
        return { left, size, delay, duration, drift, id: i };
      }),
    [],
  );

  return (
    <div style={root} aria-hidden>
      <style>{keyframes}</style>
      {/* base gradient + torch glow */}
      <div style={baseGradient} />
      <div style={torchGlow} />
      {/* embers */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        {embers.map((e) => (
          <span
            key={e.id}
            style={{
              position: "absolute",
              bottom: -10,
              left: `${e.left}%`,
              width: e.size,
              height: e.size,
              borderRadius: "50%",
              background: MENU.goldBright,
              boxShadow: `0 0 ${e.size * 2}px ${MENU.gold}`,
              opacity: 0,
              // custom props consumed by the keyframes
              ["--drift" as string]: `${e.drift}px`,
              animation: `db-ember ${e.duration}s linear ${e.delay}s infinite`,
            }}
          />
        ))}
      </div>
      {/* vignette on top */}
      <div style={vignette} />
    </div>
  );
}

const root: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  background: MENU.ink,
  pointerEvents: "none",
};
const baseGradient: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(120% 90% at 50% 8%, #1c2130 0%, #10131c 42%, #07080c 100%)",
};
const torchGlow: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(60% 42% at 50% 108%, rgba(201,165,74,0.22), transparent 70%)",
  mixBlendMode: "screen",
};
const vignette: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(120% 100% at 50% 45%, transparent 45%, rgba(0,0,0,0.55) 100%)",
};

const keyframes = `
@keyframes db-ember {
  0%   { transform: translate(0, 0) scale(1); opacity: 0; }
  12%  { opacity: 0.9; }
  85%  { opacity: 0.5; }
  100% { transform: translate(var(--drift, 0px), -78vh) scale(0.4); opacity: 0; }
}`;
