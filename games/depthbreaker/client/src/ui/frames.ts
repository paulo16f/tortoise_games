// The standardized Dark Fantasy panel chrome (user's reference: the pack's
// demo screenshots — ornate metal frame, dark parchment well, gothic gold
// titles). ONE 9-slice border-image from the pack's Frame_Box sprite powers
// every panel, so swapping the sprite restyles the whole game at once.

import type { CSSProperties } from "react";

/**
 * Ornate framed panel container. Replaces the old flat rgba box on every
 * panel. border-image slices the 512x512 frame sprite: corners stay pixel-
 * perfect ornaments, edges stretch. The inner well is painted underneath.
 */
export const framedPanel: CSSProperties = {
  border: "22px solid transparent",
  borderImage: "url(/ui/synty/frame_box.png) 150 stretch",
  borderRadius: 4,
  background: "linear-gradient(180deg, rgba(16,17,22,0.96), rgba(8,9,12,0.97)) padding-box",
  boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
};

/** Gothic gold panel title (the pack's "Treasure Chest" banner look). */
export const frameTitle: CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: 0.8,
  color: "#e8d9a8",
  textShadow: "0 2px 3px #000, 0 0 12px rgba(201,165,74,0.25)",
};

/** Slot well matching the reference inventory grid (dark inset, thin rim). */
export const frameSlot: CSSProperties = {
  background: "linear-gradient(180deg, rgba(24,26,32,0.9), rgba(10,11,14,0.95))",
  border: "1px solid rgba(201,165,74,0.22)",
  boxShadow: "inset 0 2px 6px rgba(0,0,0,0.7)",
  borderRadius: 4,
};
