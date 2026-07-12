// Audio sample-bank manifest — maps a sound KEY to a file under client/public/audio/.
// This is the drop-in seam: the user drops real audio files (CC0 / bought packs —
// Sonniss GDC bundles, freesound CC0, Kenney.nl) into public/audio/ and adds an
// entry here; sfx.ts plays the sample instead of its procedural fallback. Empty by
// default so nothing is fetched (no 404s) until real files exist — the game runs on
// the richer procedural synthesis meanwhile.
//
// Recognised keys (all optional):
//   Combat by event kind:  "hit" | "crit" | "death" | "heal"
//   Generic skill cast:     "skill"
//   Per-skill cast:         "cast:<skillId>"  e.g. "cast:fireball", "cast:smite"
//   Economy/world:          "gold" | "loot" | "gather"
//   Looping ambience:       "ambient:dungeon"
//
// Example once files are added:
//   export const AUDIO_MANIFEST = {
//     "cast:fireball": "/audio/cast_fireball.ogg",
//     hit: "/audio/hit.ogg",
//     "ambient:dungeon": "/audio/ambient_dungeon.ogg",
//   };

export const AUDIO_MANIFEST: Record<string, string> = {
  // (empty — drop files into public/audio/ and add entries here)
};
