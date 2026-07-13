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
  // Starter BODY variants (price 0 = always owned, never sold): the ♂/♀
  // choice at character creation is just one of these equipped from day one.
  { id: "knight_f", name: "Knight (Female)", kind: "model", price: 0, model: "knightF" },
  { id: "warden_m", name: "Cleric (Male)", kind: "model", price: 0, model: "wardenM" },
  { id: "reaper_b", name: "Reaper (Risen)", kind: "model", price: 0, model: "reaperB" },
  { id: "necro_b", name: "Necromancer (Witch)", kind: "model", price: 0, model: "necroB" },
] as const;

export function skinDef(id: string): SkinDef | undefined {
  return SKIN_CATALOG.find((s) => s.id === id);
}

/** Free body-variant skins: always owned, equippable by anyone, never sold. */
export function isStarterSkin(id: string): boolean {
  return skinDef(id)?.price === 0;
}

/** All valid skin ids the shop sells (excludes the "" default + starters). */
export function isSellableSkin(id: string): boolean {
  const def = skinDef(id);
  return !!def && def.price > 0;
}
