// Synty "INTERFACE - Dark Fantasy HUD" sprite kit. The PNGs live under
// client/public/ui/synty/ (extracted from the pack's unitypackage). This module
// is the single place that references them, so swapping a sprite or retuning a
// 9-slice inset is a one-line change. All sizes/insets are CSS-tunable — the user
// can eyeball the running game and adjust here.

import type { CSSProperties, ReactNode } from "react";

export const UI_SPRITES = {
  frameBox: "/ui/synty/frame_box.png", // ornate square 9-slice frame (panels + slots)
  frameBar: "/ui/synty/frame_bar.png", // ornate horizontal bar frame (transparent centre)
  frameBarBg: "/ui/synty/frame_bar_bg.png",
  frameBoxBg: "/ui/synty/frame_box_bg.png",
} as const;

/**
 * A 9-slice ornate frame drawn as a CSS border-image — use for panels of any
 * size (the corners stay crisp while the edges stretch). `border` is how thick
 * the frame renders; `slice` is the source inset in px (the frame art's border
 * thickness in the 512px sprite). Both are tunable if the frame looks off.
 */
export function frameBorder(border = 24, slice = 116): CSSProperties {
  return {
    borderStyle: "solid",
    borderWidth: border,
    borderImage: `url(${UI_SPRITES.frameBox}) ${slice} / ${border}px / 0 stretch`,
  };
}

/** A square ornate slot (hotbar/inventory) — the whole frame scaled to the box. */
export function slotFrame(): CSSProperties {
  return {
    backgroundImage: `url(${UI_SPRITES.frameBox})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
  };
}

/**
 * An ornate stat bar: a coloured fill inset within the frame's transparent
 * centre, with the metal frame overlaid on top. `inset` is the fill's padding
 * inside the frame (tunable to line the fill up with the frame's opening).
 */
export function SpriteBar({
  frac,
  color,
  width = 220,
  height = 20,
  track = "rgba(6,7,10,0.85)",
  inset = "22% 6%",
}: {
  frac: number;
  color: string;
  width?: number | string;
  height?: number;
  track?: string;
  inset?: string;
}) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div style={{ position: "relative", width, height }}>
      <div style={{ position: "absolute", inset, borderRadius: 2, overflow: "hidden", background: track }}>
        <div style={{ width: `${f * 100}%`, height: "100%", background: color, transition: "width 120ms linear" }} />
      </div>
      <img src={UI_SPRITES.frameBar} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
    </div>
  );
}

/** Wrap content in a 9-slice ornate panel frame (keeps the caller's own bg). */
export function Frame({ children, border, slice, style }: { children: ReactNode; border?: number; slice?: number; style?: CSSProperties }) {
  return <div style={{ ...frameBorder(border, slice), ...style }}>{children}</div>;
}
