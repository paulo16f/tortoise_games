# Self-Service Guide — edit characters, movements & weapons yourself

Everything lives in ONE file:
`My project (1)/Assets/Editor/DepthbreakerExport/DepthbreakerGltfExport.cs`

After ANY edit there, run ONE command (Unity must be CLOSED):

```powershell
& "C:\Program Files\Unity\Hub\Editor\6000.5.2f1\Editor\Unity.exe" -batchmode -quit `
  -projectPath "C:\Users\vlgp6\Projects\Tortoise-Games\games\depthbreaker\My project (1)" `
  -executeMethod DepthbreakerGltfExport.ExportAll -logFile export.log
```

Then in the game repo: `npm run validate:assets` (tells you if a clip is
missing/misnamed) and check visually at `http://localhost:5184/?debugAnim`.
(With Unity OPEN you can instead use the menu: **Depthbreaker → Export
Character GLBs** — same thing.)

---

## 1. Change a CHARACTER's mesh

Find the class in `Characters[]` and swap the first string:

```csharp
new("Character_Hero_Knight_Male", "warrior", KnightKit, DungeonFbx),
//    ^ mesh name                  ^ output   ^ moveset  ^ source pack
```

Rules: mesh name must exist in the source FBX; `DungeonFbx` = PolygonDungeon
meshes, omit the 4th argument = DungeonRealms meshes. Output names are wired
into the game — don't rename them.

**Available meshes — PolygonDungeon (16):** Character_Ghost_01/02,
Character_Goblin_Female/Male/Shaman/WarChief/Warrior_Female/Warrior_Male,
Character_Hero_Knight_Female/Male, Character_Rock_Golem,
Character_Skeleton_Knight/Slave_01/Soldier_01/Soldier_02,
Character_Tormented_Soul

**Available meshes — DungeonRealms (11):** Chr_Hero_Female_01/Male_01,
Chr_Nomad_Female_01/02, Chr_Nomad_Male_01/02/03, Chr_Skeleton_01/02/03,
Chr_Undead_Knight_01

**Output → game mapping:** `warrior`=knight ♂, `knight_f`=knight ♀,
`warden`=cleric ♀, `warden_m`=cleric ♂, `reaper`/`reaper_b`=reaper forms,
`mage`=necro ♂, `necro_b`=necro ♀, `skeleton`=trash mobs,
`undead_knight`=elites + paid skin, `boss_skeleton`=boss.

## 2. Change a MOVEMENT / animation

Each class has a kit block (`KnightKit`, `ClericKit`, `ReaperKit`, `NecroKit`,
`SkeletonKit`). Each line = one runtime clip:

```csharp
new("attack", Swd + "/Attack/HeavyCombo01/A_Attack_HeavyCombo01A_Sword.fbx", false),
//   ^ runtime name (NEVER change)   ^ animation FBX path                    ^ loop?
```

Runtime names: `idle` `walk` `run` `attack` `cast` `hit` `death`
(loop=true for idle/walk/run, false for the rest). Anything NOT overridden in
a kit uses the shared `Clips[]` base at the bottom.

**Browse animations in Unity's Project panel** (click an FBX → press ▶ in the
Inspector to preview), then copy its path. Roots:
- Locomotion: `Assets/Synty/AnimationBaseLocomotion/Animations/Polygon/{Masculine|Feminine}/Locomotion/{Walk|Run|Sprint|Crouch|Shuffle}/`
- Sword combat: `Assets/Synty/AnimationSwordCombat/Animations/Polygon/{Idle|Attack|Hit|Death}/`
- Bow combat (nested): `Assets/Synty/AnimationSwordCombat/Animations/AnimationBowCombat/Animations/Polygon/`

**Rules:** never pick `_RootMotion_` / `_RM_` / `FPV` / `Cmp` variants — only
the plain in-place ones (`..._Sword.fbx`, `..._Masc.fbx`, `..._Femn.fbx`,
`..._Neut.fbx`). If a clip looks chopped in game: it's auto-speed-fitted to
the combat window — that's intended (hit 0.34s, swing 0.62s).

## 3. Change / add a WEAPON model

`Weapons[]` in the same file:

```csharp
("Assets/Synty/PolygonDungeon/Models/SM_Wep_Axe_01.fbx", "axe"),
```

Browse `PolygonDungeon/Models/SM_Wep_*.fbx` (~90 weapons: axes, hammers,
maces, spears, staves, shields, goblin/crystal/ornate sets) and
`PolygonDungeonRealms/Models/SM_Wep_*` (knives, bows are NOT in these packs).
The output name maps to the weapon archetype in
`client/src/game/actors/useModel.ts` → `WEAPON_MODELS` (one line per
archetype: sword/axe/mace/hammer/dagger/spear/staff/wand/bow).

## 4. Add a new SKIN / body variant (3 small edits + export)

1. Exporter: add a `CharacterJob` line with a new output name (e.g. `"knight_g"`).
2. `packages/sim/src/skins.ts`: add `{ id: "knight_g", …, price: 0 (free) or
   gold price (shop), model: "knightG" }`.
3. `client/src/game/actors/useModel.ts`: add the const + model entry
   (copy any existing line, change url/key) + one line in `SKIN_MODELS`.
Run the export; done. Price 0 = free starter form, price > 0 = shop cosmetic.

## 5. Skill VFX (Higgsfield)

See `docs/VFX_PROMPT_SHEET.md` — generate a clip on pure black, then:
`node tools/video_to_flipbook.mjs clip.mp4 fireball_impact` and paste the
printed line into `client/src/game/fx/skillVfx.ts`. Needs ffmpeg
(`winget install ffmpeg`).

## Troubleshooting

| symptom | cause / fix |
|---|---|
| export.log: "Mesh X not found … have [list]" | typo'd mesh name — the error lists all valid names in that FBX |
| export.log: "not a humanoid rig" | that FBX's import settings aren't Rig→Humanoid — select it in Unity, Inspector→Rig→Animation Type: Humanoid, Apply |
| character T-poses in game | a clip failed to bake — `npm run validate:assets` names it |
| animation slides / drifts | you picked a `_RootMotion_` variant — use the plain one |
| game doesn't show the change | hard-refresh the browser (Ctrl+Shift+R); GLBs are cached |
