// Shared visual language for the pre-game menus (login / character select /
// create). A dark, gold-accented high-fantasy look — WoW-adjacent — so the
// intro and roster screens feel like a game front-end, not a form. Pure style
// constants + reusable CSSProperties; no logic. Colours are chosen to read as
// "aged bronze on carved stone".

import type { CSSProperties } from "react";

export const MENU = {
  gold: "#c9a54a",
  goldBright: "#efd48a",
  goldDim: "#7c6a33",
  ink: "#07080c",
  stone: "#12141b",
  stoneLit: "#1b1e28",
  parchment: "#ece4cf",
  parchmentDim: "#a49c86",
  danger: "#c0563f",
  ok: "#6fbf73",
  /** Serif display stack for headings — no external font, but epic-leaning. */
  display: "'Trajan Pro', 'Cinzel', Georgia, 'Times New Roman', serif",
  body: "system-ui, -apple-system, Segoe UI, sans-serif",
} as const;

/** Full-screen menu root: centers content over the atmospheric backdrop. */
export const menuScreen: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: MENU.parchment,
  fontFamily: MENU.body,
  overflow: "hidden",
};

/** A carved-stone panel with a bronze hairline and inner shadow. */
export const framePanel: CSSProperties = {
  background: "linear-gradient(180deg, rgba(24,26,34,0.92), rgba(12,13,18,0.94))",
  border: `1px solid ${MENU.goldDim}`,
  borderRadius: 6,
  boxShadow: "0 18px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
};

/** The primary call-to-action — "Enter World" / "Create". Gold, weighty. */
export function goldButton(enabled: boolean): CSSProperties {
  return {
    padding: "13px 26px",
    borderRadius: 5,
    border: `1px solid ${enabled ? MENU.gold : "#3a3730"}`,
    background: enabled
      ? "linear-gradient(180deg, #d9b95e, #a5842f)"
      : "linear-gradient(180deg, #2a2b31, #202127)",
    color: enabled ? "#26200c" : "#6b6858",
    fontFamily: MENU.display,
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    cursor: enabled ? "pointer" : "default",
    boxShadow: enabled ? "0 4px 18px rgba(201,165,74,0.28)" : "none",
    transition: "transform 0.08s ease, box-shadow 0.15s ease",
  };
}

/** Secondary bronze-outline button. */
export function ghostButton(enabled = true): CSSProperties {
  return {
    padding: "10px 18px",
    borderRadius: 5,
    border: `1px solid ${MENU.goldDim}`,
    background: "rgba(20,22,30,0.8)",
    color: MENU.parchment,
    fontFamily: MENU.body,
    fontSize: 14,
    fontWeight: 600,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.5,
  };
}

export const menuField: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 13px",
  borderRadius: 5,
  border: `1px solid ${MENU.goldDim}`,
  background: "rgba(8,9,13,0.85)",
  color: MENU.parchment,
  fontSize: 14,
  fontFamily: MENU.body,
  outline: "none",
};

export const linkButton: CSSProperties = {
  background: "transparent",
  border: "none",
  color: MENU.gold,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: MENU.body,
};

/** A thin gold divider with a diamond in the middle (WoW-ish flourish). */
export const goldRule: CSSProperties = {
  height: 1,
  background: `linear-gradient(90deg, transparent, ${MENU.goldDim}, transparent)`,
};
