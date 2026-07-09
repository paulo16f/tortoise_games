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
export const ENEMY_AGGRO_RADIUS = 12;
export const ENEMY_LEASH_DISTANCE = 40;

/** Class ids must match the backend characters.class_id CHECK constraint. */
export type ClassId = "bruiser" | "mage" | "warden";
