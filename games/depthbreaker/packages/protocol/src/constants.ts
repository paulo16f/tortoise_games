// Gameplay + netcode constants shared by realtime server and client.

/** Server simulation rate. The authoritative loop integrates at this rate. */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/** How often the client samples held input and sends it to the server. */
export const INPUT_SEND_HZ = 20;

/**
 * Player ground movement speed (world units / second). Tuned down from 6 to
 * keep it closer to what the chibi Mini Fantasy locomotion clips can visually
 * sustain without exaggerated playback. The client uses fixed clip playback
 * scales from motionProfiles.ts, while the server remains authoritative for
 * position.
 */
export const PLAYER_SPEED = 3.4;

/** Seconds a dead player waits before respawning at the zone spawn point. */
export const RESPAWN_SECONDS = 4;

/** The single shared Colyseus room name for the Phase 0 hub/zone. */
export const ZONE_ROOM = "zone";

/** Enemy tuning shared so the client can show ranges if it wants. */
export const ENEMY_AGGRO_RADIUS = 10;
export const ENEMY_LEASH_DISTANCE = 40;

/**
 * Playable classes (POLYGON Dark Fortress heroes). Ids must match the backend
 * characters.class_id CHECK constraint (migration 0009).
 * - knight: frontline melee tank
 * - reaper: heavy two-hand melee DPS (Death Knight)
 * - cleric: healer / support caster
 * - necromancer: ranged burst + damage-over-time caster
 */
export type ClassId = "knight" | "reaper" | "cleric" | "necromancer";

/** Display metadata for the character-select + HUD. */
export const CLASS_META: Record<ClassId, { label: string; role: string; blurb: string }> = {
  knight: { label: "Knight", role: "Tank", blurb: "Sturdy frontline melee." },
  reaper: { label: "Reaper", role: "Melee DPS", blurb: "Slow, heavy soul-fire hits." },
  cleric: { label: "Cleric", role: "Healer", blurb: "Holy caster; heals + wards." },
  necromancer: { label: "Necromancer", role: "Caster", blurb: "Ranged burst from afar." },
};
