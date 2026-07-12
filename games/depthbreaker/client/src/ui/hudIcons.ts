// Skill / item icon registry. Keyed by id so the hotbar + item slots show a
// sprite when one is mapped, and fall back to the text label otherwise. The
// Synty Dark Fantasy HUD pack ships icon sets (Icons_Status → skills,
// Icons_Weapons/Inventory → items) — extract the chosen PNGs into
// public/ui/synty/icons/ and add entries here; nothing else changes.

/** skillId → icon URL under /ui/synty/icons/. Empty = text-label fallback. */
export const SKILL_ICONS: Record<string, string> = {
  // e.g. fireball: "/ui/synty/icons/skill_fireball.png",
};

/** itemId → icon URL. Empty = initials fallback. */
export const ITEM_ICONS: Record<string, string> = {};

export function iconForSkill(skillId: string): string | undefined {
  return SKILL_ICONS[skillId];
}
export function iconForItem(itemId: string): string | undefined {
  return ITEM_ICONS[itemId];
}
