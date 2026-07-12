# GLB Import Guide — swapping in the real Dark Fortress heroes + weapons

A quick, practical checklist for replacing the four **placeholder-mapped** player
models (and the missing weapon models) with real POLYGON Dark Fortress GLBs.
Nothing in the game code needs to change structurally — the model registry is
data, so each swap is one line once the GLB exists.

This is the fast path. The deep rigging/animation rules live in
[`README.md` → "Character rigging rules" + "Importing a new Synty character"](../README.md)
— read those once before your first export; this guide is the day-to-day version.

---

## What we're swapping

Today the classes render old Dungeon Realms placeholders (see
`client/src/game/actors/useModel.ts`):

| Class        | Placeholder now | Target GLB (yours)        |
|--------------|-----------------|---------------------------|
| knight       | `warrior.glb`   | `knight.glb`              |
| reaper       | `undead_knight` | `reaper.glb`              |
| cleric       | `warden.glb`    | `cleric.glb`              |
| necromancer  | `mage.glb`      | `necromancer.glb`         |

And the weapons: only `sword.glb` + `staff.glb` exist; every other archetype
falls back to one of those. Missing GLBs: `axe`, `hammer`, `mace`, `dagger`,
`spear`, `wand`, `bow`.

---

## 0. The one hard requirement: clip names

Every character GLB **must** bake exactly these 6 animation clips, named exactly
(this is `SYNTY_DEPTHBREAKER_CLIPS` in `useModel.ts`):

```
idle, walk, run, attack, hit, death
```

If a clip is missing or misnamed the character will T-pose or freeze. That's the
single most common import failure. Everything else below is mechanical.

Files go here (create the file, keep the `.glb` extension lowercase):
```
client/public/models/synty/depthbreaker/characters/<name>.glb
client/public/models/synty/depthbreaker/weapons/<name>.glb
```

---

## 1. Export the GLB — pick the path that matches what you have

### Path A — automated (you have the Synty FBX + it shares the animation-pack rig)
This reuses the existing Blender pipeline that already produced warrior/warden/mage.
It retargets the Sidekick locomotion + combat clips onto your mesh and bakes the
shoulder-relaxed fix — no per-character tuning.

1. Drop the source FBX under `Source_Files/Characters/` (animation packages
   extracted into `_restored/`), matching the existing layout.
2. Add the character to the `CHARACTERS` list in
   `tools/convert_synty_depthbreaker.py`.
3. Run it via Blender (quoted, forward-slash paths — an unquoted backslash path
   silently exports to the wrong folder):
   ```bash
   & "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background \
     --python tools/convert_synty_depthbreaker.py -- \
     --source "C:/Users/vlgp6/Projects/unity sheets/Source_Files" \
     --restored "C:/Users/vlgp6/Projects/unity sheets/_restored" \
     --out "client/public/models/synty/depthbreaker"
   ```
   Keep `export_animation_mode="NLA_TRACKS"` (the default `"ACTIONS"` bakes
   cross-clip contamination).

> ⚠️ Dark Fortress may not use the *same* rest-pose rig as Mini Fantasy. If the
> auto-retarget comes out T-posed or with broken swings, that's the known
> rig-mismatch (README's rigging section) — the fix belongs in the Blender
> script (`retarget_rotation_curves` computed from the rig's own rest pose),
> never as a client-side per-bone hack. If Dark Fortress ships its own compatible
> clips, you can skip retargeting and just export them under the 6 names.

### Path B — direct export (you already have a rigged + animated model)
If you're exporting straight from Blender/Unity with the animations on it:
- Export **glTF Binary (.glb)**, +Y up, apply transforms, include the armature +
  all 6 actions, name the actions `idle/walk/run/attack/hit/death`.
- Keep a right-hand bone named `Hand_R` (that's the weapon attach point — see §4).
- Roughly human-scaled (~1.8 m tall); fine-tuning is done in the manifest/registry.

### Weapons
Weapons are static meshes (no animation): export each as its own `.glb` into
`.../weapons/`. Model the grip so the handle sits at the origin pointing sensibly
— the exact hand offset/rotation is authored per-archetype in code (§4), not in
the mesh.

---

## 2. Register in the runtime manifest

`client/public/models/synty/runtime/manifest.json` gates what the client may
render. Copy an existing `characters[]` entry (e.g. `warrior`) and edit `key` +
`url`. Leave `runtimeApproved: false` for now:

```jsonc
{
  "key": "knight",
  "url": "/models/synty/depthbreaker/characters/knight.glb",
  "visualHeight": 1.8,
  "radius": 0.45,
  "requiredClips": ["idle", "walk", "run", "attack", "hit", "death"],
  "clips": { "idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death" },
  "motionProfile": "humanoidPlayer",
  "locomotionSet": "humanoid",
  "walkRuntimeApproved": true,
  "runtimeApproved": false,
  "fallback": "/models/kaykit/characters/kaykit_knight.glb"
  // naturalHeight / restMinY / assetVersion / strideNorm are written by the validator — DON'T hand-edit
}
```

Then run the validator until clean — it verifies the clips exist and **writes**
`naturalHeight`, `restMinY`, `assetVersion`, and `strideNorm` back into the entry
from the actual GLB:
```bash
npm run validate:assets
```
Once it passes, flip that entry to `"runtimeApproved": true`.

---

## 3. Wire the character into the model registry

In `client/src/game/actors/useModel.ts`:

**a.** Add the URL constant (next to `SYNTY_DB_WARRIOR` etc.):
```ts
const SYNTY_DB_KNIGHT = "/models/synty/depthbreaker/characters/knight.glb";
const SYNTY_DB_REAPER = "/models/synty/depthbreaker/characters/reaper.glb";
const SYNTY_DB_CLERIC = "/models/synty/depthbreaker/characters/cleric.glb";
const SYNTY_DB_NECROMANCER = "/models/synty/depthbreaker/characters/necromancer.glb";
```

**b.** Add entries to `SYNTY_DEPTHBREAKER_MODELS` (2nd arg = the manifest `key`;
copy the `weaponTransform` from `warrior`/`mage` and tweak only if the weapon
sits wrong — see §4). Give casters the staff, melee the sword:
```ts
  knight:      makeCharacterModel(SYNTY_DB_KNIGHT,      "knight",      "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8,  rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  reaper:      makeCharacterModel(SYNTY_DB_REAPER,      "reaper",      "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8,  rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  cleric:      makeCharacterModel(SYNTY_DB_CLERIC,      "cleric",      "humanoidPlayer", { weaponUrl: SYNTY_DB_STAFF, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.78, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  necromancer: makeCharacterModel(SYNTY_DB_NECROMANCER, "necromancer", "humanoidPlayer", { weaponUrl: SYNTY_DB_STAFF, handBoneNames: ["Hand_R"], targetHeight: 1.75, visualHeight: 1.75, radius: 0.43, weaponTransform: { scale: 0.78, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
```

**c.** Repoint `PLAYER_MODELS` (this is the actual placeholder swap — 4 lines):
```ts
const PLAYER_MODELS: Record<ClassId, CharacterModel> = {
  knight: SYNTY_DEPTHBREAKER_MODELS.knight,
  reaper: SYNTY_DEPTHBREAKER_MODELS.reaper,
  cleric: SYNTY_DEPTHBREAKER_MODELS.cleric,
  necromancer: SYNTY_DEPTHBREAKER_MODELS.necromancer,
};
```

**d.** Add each character URL to the `useGLTF.preload(...)` set at the bottom of
the file.

You can do all four at once or one at a time — an un-swapped class just keeps
rendering its placeholder, so partial imports are safe.

---

## 4. Wire the weapons

Drop the GLBs into `.../weapons/`, add URL constants, and point the archetypes at
them in `WEAPON_MODELS` (currently everything falls back to sword/staff):
```ts
const SYNTY_DB_AXE    = "/models/synty/depthbreaker/weapons/axe.glb";
const SYNTY_DB_HAMMER = "/models/synty/depthbreaker/weapons/hammer.glb";
const SYNTY_DB_DAGGER = "/models/synty/depthbreaker/weapons/dagger.glb";
const SYNTY_DB_SPEAR  = "/models/synty/depthbreaker/weapons/spear.glb";
const SYNTY_DB_WAND   = "/models/synty/depthbreaker/weapons/wand.glb";
const SYNTY_DB_BOW    = "/models/synty/depthbreaker/weapons/bow.glb";

const WEAPON_MODELS: Record<WeaponType, string> = {
  sword: SYNTY_DB_SWORD,
  axe:   SYNTY_DB_AXE,
  mace:  SYNTY_DB_SWORD,   // reuse sword until a mace GLB exists
  hammer: SYNTY_DB_HAMMER,
  dagger: SYNTY_DB_DAGGER,
  spear:  SYNTY_DB_SPEAR,
  staff:  SYNTY_DB_STAFF,
  wand:   SYNTY_DB_WAND,
  bow:    SYNTY_DB_BOW,
};
```

**Weapon placement gotcha:** this rig carries an internal ~0.01 armature scale, so
`weaponTransform.scale`/`position` are counter-scaled by the hand bone's world
scale (handled in `HeldWeapon` in `AnimatedCharacter.tsx`) — meaning the numbers
are "relative to the character's visible size," not raw units. Don't eyeball Euler
angles; derive `rotation` from the world-space direction you want the weapon's
long axis to point (forearm direction for a blade, straight up for a staff),
convert to the hand bone's local space, and solve with
`Quaternion.setFromUnitVectors`. Start by copying an existing `weaponTransform`
and only nudge if it's visibly off.

---

## 5. Verify (numbers first, screenshot last)

```bash
npm run validate:assets            # clips present; writes naturalHeight/restMinY
npm run typecheck
npm test -- --run
npm run build --workspace client
```
Then in the browser: create one character per swapped class and check idle → move
→ attack → take a hit, plus that the held weapon sits in the hand. If a walk looks
wrong, the lever is `PLAYER_SPEED` vs the clip's foot-speed (see README's
locomotion note) — **not** a per-bone client override.

---

## TL;DR

1. Export GLB with clips named `idle/walk/run/attack/hit/death` → drop in
   `.../depthbreaker/characters/`.
2. Add a `characters[]` entry to the runtime `manifest.json`, `npm run
   validate:assets`, flip `runtimeApproved: true`.
3. Add `SYNTY_DB_*` const + `SYNTY_DEPTHBREAKER_MODELS` entry + repoint
   `PLAYER_MODELS` + preload, in `useModel.ts`.
4. Weapons: drop GLB → one line in `WEAPON_MODELS`.
5. `validate:assets` + `typecheck` + browser check.
