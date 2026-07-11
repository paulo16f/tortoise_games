// Cosmetic skin catalog — a pure GOLD sink (Kintara's #1 sink). Buying a skin
// debits wallet gold and grants account-wide ownership; equipping sets the
// character's skin. Data-first so the POLYGON Dungeon Realms characters slot in
// on art import.
//
// Two kinds:
//   - "model": swaps the whole character GLB to another runtime-approved model
//     (`model` is a SYNTY_DEPTHBREAKER_MODELS key the client resolves).
//   - "atlas": swaps only the material texture (recolor) — reserved; no recolor
//     atlases are wired yet, so the launch catalog is model swaps only.
// skinId "" is always the class default (free, always owned, never in the shop).

export type SkinKind = "model" | "atlas";

export interface SkinDef {
  id: string;
  name: string;
  kind: SkinKind;
  price: number;
  /** For kind "model": the client model key to render instead of the default. */
  model?: string;
  /** For kind "atlas": the recolor atlas url (future). */
  atlasUrl?: string;
}

export const SKIN_CATALOG: readonly SkinDef[] = [
  { id: "skeleton", name: "Risen Skeleton", kind: "model", price: 200, model: "skeleton" },
  { id: "undead_knight", name: "Undead Knight", kind: "model", price: 350, model: "undeadKnight" },
  { id: "bone_colossus", name: "Bone Colossus", kind: "model", price: 600, model: "bossSkeleton" },
] as const;

export function skinDef(id: string): SkinDef | undefined {
  return SKIN_CATALOG.find((s) => s.id === id);
}

/** All valid skin ids the shop sells (excludes the "" default). */
export function isSellableSkin(id: string): boolean {
  return SKIN_CATALOG.some((s) => s.id === id);
}
