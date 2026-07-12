// Skill / item icon registry. Keyed by id so the hotbar + item slots show a
// sprite when one is mapped, and fall back to the text label otherwise. The
// Synty Dark Fantasy HUD pack ships icon sets (Icons_Status → skills,
// Icons_Weapons/Inventory → items) — extract the chosen PNGs into
// public/ui/synty/icons/ and add entries here; nothing else changes.

/** skillId → icon URL under /ui/synty/icons/. Empty = text-label fallback.
 *  Mapped from the Dark Fantasy pack's Icons_Status set by theme (fire→Burninating,
 *  frost→Cold, lifesteal→Vampiric, execute→Dead, taunt→Targeted, …). */
const ICON_SKILLS = [
  "basic_attack", "cleave", "whirlwind", "charge", "soul_reap", "execute", "taunt",
  "shield_wall", "bulwark", "fireball", "frost_nova", "corruption", "smite", "mend",
  "renew", "blessing",
  // Kit-completion additions (rupture→Wounded, holy_nova→Up, sanctuary→DefenseUp,
  // drain_life→Thirst, bone_spear→BrokenBones, bone_armor→FortifiedDefense).
  "rupture", "holy_nova", "sanctuary", "drain_life", "bone_spear", "bone_armor",
];
export const SKILL_ICONS: Record<string, string> = Object.fromEntries(
  ICON_SKILLS.map((id) => [id, `/ui/synty/icons/skill_${id}.png`]),
);

/** itemId → icon URL. Empty = initials fallback. */
export const ITEM_ICONS: Record<string, string> = {};

export function iconForSkill(skillId: string): string | undefined {
  return SKILL_ICONS[skillId];
}
export function iconForItem(itemId: string): string | undefined {
  return ITEM_ICONS[itemId];
}
