# Audio drop-in folder

Drop real audio files here and register them in
`client/src/game/fx/audioManifest.ts` — `sfx.ts` plays the sample instead of its
procedural fallback. Until a key has both a file here **and** a manifest entry,
the game uses the built-in procedural synthesis (per-skill flavored), so audio
works with zero files today.

## Recognised keys → suggested filenames

| Manifest key        | When it plays                          | Suggested file            |
|---------------------|----------------------------------------|---------------------------|
| `hit`               | any melee/skill damage impact          | `hit.ogg`                 |
| `crit`              | critical hit                           | `crit.ogg`                |
| `death`             | an enemy/player dies                   | `death.ogg`               |
| `heal`              | a heal lands                           | `heal.ogg`                |
| `skill`             | generic skill cast (fallback)          | `skill.ogg`               |
| `cast:fireball`     | Fireball cast                          | `cast_fireball.ogg`       |
| `cast:smite`        | Smite cast                             | `cast_smite.ogg`          |
| `cast:frost_nova`   | Frost Nova cast                        | `cast_frost_nova.ogg`     |
| `cast:corruption`   | Corruption cast                        | `cast_corruption.ogg`     |
| `cast:<skillId>`    | any other skill (see skills.ts ids)    | `cast_<skillId>.ogg`      |
| `gold`              | gold gained                            | `gold.ogg`                |
| `loot`              | item looted                            | `loot.ogg`                |
| `gather`            | mining/fishing tick                    | `gather.ogg`              |
| `ambient:dungeon`   | looping dungeon bed (in-run)           | `ambient_dungeon.ogg`     |

## Format
- Short one-shots (`hit`, `cast:*`, …): **OGG** or MP3, mono, ~0.1–0.6 s, normalized.
- `ambient:dungeon`: a seamless **loop** (OGG), 20–60 s, quiet/atmospheric.

## Good CC0 sources
- Sonniss "GDC Game Audio Bundle" (free, huge, license-clear)
- freesound.org (filter to CC0)
- Kenney.nl audio packs (CC0)

## Example manifest entry
```ts
export const AUDIO_MANIFEST = {
  hit: "/audio/hit.ogg",
  "cast:fireball": "/audio/cast_fireball.ogg",
  "ambient:dungeon": "/audio/ambient_dungeon.ogg",
};
```
