# Depthbreaker

Web 3D multiplayer roguelike (MMO-lite): Hades-style runs that reset on death,
an account axis (meta-currency, permanent upgrade tree) that persists, and a
shared hub with real players. Fully server-authoritative.

**Stack (web ecosystem):** React Three Fiber client - Colyseus authoritative
realtime server - Fastify + PostgreSQL backend - deterministic game math shared
as one TypeScript package. All TypeScript -- no cross-language mirroring.

- **Design doc (normative):** [`docs/DEPTHBREAKER_TECHNICAL_DESIGN.md`](../../docs/DEPTHBREAKER_TECHNICAL_DESIGN.md)
- **Launch spec:** [`GAME_LAUNCH_SPEC.md`](GAME_LAUNCH_SPEC.md) -- **LAUNCH BLOCKED** (Solana layer deferred to Phase 2)
- **Phase 2 token economy (normative):** [`docs/PHASE2_TOKEN_ECONOMY.md`](docs/PHASE2_TOKEN_ECONOMY.md) -- Kintara-style model: game mints gold only; players trade gold for the token P2P; no payout signer
- **Math contract:** [`shared-spec/GAME_MATH_SPEC.md`](shared-spec/GAME_MATH_SPEC.md) + frozen golden vectors in `shared-spec/vectors/`

## Layout (npm workspace)

```
packages/sim/       @depthbreaker/sim -- deterministic math (RNG, combat, XP,
                    threat, loot, dungeon). Vitest-tested against shared-spec vectors.
packages/protocol/  @depthbreaker/protocol -- Colyseus state schema, client<->server
                    message types, gameplay constants, plain view interfaces.
backend/            Fastify + pg + jose: auth (guest/email), characters, runs,
                    meta-progression, /internal reporting, /api/health.
realtime/           Colyseus authoritative server: ZoneRoom (movement, combat,
                    enemy FSM/threat), join-ticket auth, backend reporting.
client/             React Three Fiber (Vite): renders the synced zone, WASD move,
                    click-to-target, follow camera, HUD. Loads organized GLB asset packs.
infra/              docker-compose (postgres + optional nginx), TLS/wss guide.
shared-spec/        Language-neutral math spec + golden vectors.
unity/              SUPERSEDED by the web stack. Holds SETUP.md only; Unity/Synty
                    is now an art-export pipeline, not the runtime. Export Synty
                    scenes/characters to GLB and place them under client/public/models/synty/.
```

## Run it on localhost

From `games/depthbreaker/` (one `npm install` covers every workspace):

```powershell
npm install

# 1. Database (Docker) -- or use a local Postgres and set DATABASE_URL
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Three dev servers, one per terminal:
npm run dev:backend     # Fastify  -> http://localhost:3000  (migrates on boot)
npm run dev:realtime    # Colyseus -> ws://localhost:2567
npm run dev:client      # Vite     -> http://localhost:5173

# 3. Open http://localhost:5173, pick a name + class, click Play.
```

The client tries the full backend flow (guest login -> character -> run start ->
signed join ticket) and falls back to a ticketless dev join if the backend
isn't running, so the 3D scene works even with only the realtime server up.
Open the page in two tabs to see players share the hub in real time.

Controls: **WASD** move - **click an enemy** to attack (auto-attack is
server-side) - **right-drag** to look - **scroll** to zoom.

### Asset pipeline

The active web runtime loads **glTF/GLB** from `client/public/models/`. KayKit prototype art is grouped under `models/kaykit/` by characters, weapons, and dungeon tiles. Future Synty art should be exported from Unity or Blender as GLB and placed under `models/synty/`; Unity scenes and prefabs are conversion sources, not runtime assets.

Register character models in `client/src/game/actors/useModel.ts`. World/map loaders live under `client/src/game/world/`.

Current Synty conversion seed: `models/synty/` contains Mini Fantasy knight, warrior, wizard, skeleton, goblin chief, rock golem, sword, staff, and shield GLBs converted from `C:\Users\vlgp6\Projects\unity sheets\Source_Files`. `models/synty/depthbreaker/` is the runtime character set: Mini Fantasy meshes combined with compatible Sidekick animation clips named `idle`, `walk`, `run`, `attack`, `block`, `hit`, and `death`. Characters are only used at runtime after `client/public/models/synty/runtime/manifest.json` marks them `runtimeApproved`; KayKit is the automatic fallback for any character that isn't. `client/src/game/actors/characterRenderMode.ts` is a single switch (`"glb"` | `"procedural"`) between these GLB characters and a dependency-free primitive-shape placeholder renderer — flip it if the GLB pipeline needs to be bypassed for any reason.

The active dungeon is web-native and modular, built from **POLYGON Mini Fantasy** — the companion world/tile pack for the Mini Fantasy characters, chosen specifically so the environment's art style matches the chibi characters instead of clashing with them (the original POLYGON Dungeon Realms floor/props are no longer used for this reason). `models/synty/mini_world/` contains the raw converted kit (floor tile plus a curated set of dungeon-themed props — bones, crystals, mushrooms, rocks, skull, stairs, chests, campfire, crate) with its own `manifest.json` recording bounds; the pack's bridge piece is excluded from that curation since it measures as a ~3m-tall chasm set-piece with support pylons, not a flat prop. `models/synty/runtime/` contains the approved v1 runtime subset plus `manifest.json` with `visualScale`, `yOffset`, `collisionProxy`, and `runtimeApproved`. The client renders a compact combat-slice map from the shared `DEPTHBREAKER_DUNGEON` definition, and the realtime server uses that same definition for walkable collision, spawns, and the boss portal. Full Unity demo scenes are conversion references only, not runtime maps.

Validate the approved Synty runtime subset (also records each approved character's `naturalHeight`/`restMinY` bind-pose bounds into the manifest — see below):

```powershell
npm run validate:assets
```

Repeat the current Synty Mini Fantasy conversion with Blender:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools/convert_synty_minis.py -- --source "C:/Users/vlgp6/Projects/unity sheets/Source_Files" --out "client/public/models/synty"
```

Build the runtime-ready Synty characters after extracting the Unity animation packages into `C:\Users\vlgp6\Projects\unity sheets\_restored`:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools/convert_synty_depthbreaker.py -- --source "C:/Users/vlgp6/Projects/unity sheets/Source_Files" --restored "C:/Users/vlgp6/Projects/unity sheets/_restored" --out "client/public/models/synty/depthbreaker"
```

Convert the curated Mini Fantasy world kit (floor + dungeon-themed props):

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools/convert_synty_mini_world.py -- --restored "C:/Users/vlgp6/Projects/unity sheets/_restored" --out "client/public/models/synty/mini_world"
```

Map runtime follows the WoC-style split: `packages/protocol/src/mapGen.ts`'s `buildDungeon(seed, depth)` generates rooms, collision, spawns, and visual placements from the run seed, while `client/public/models/synty/runtime/manifest.json` approves the GLB paths the client may render. Do not add full Unity scene exports or mesh colliders to the runtime path for the base dungeon.

> **Always use forward slashes and double-quote every `--source`/`--restored`/`--out` value** when running these from Git Bash. An unquoted backslash path (e.g. `--out client\public\models\synty\depthbreaker`) gets silently mangled by Bash's escaping into a single flattened folder name at the repo root — the GLBs still "export successfully" from Blender's point of view, just into the wrong place, which is a confusing bug to chase after the fact.

#### Character rigging rules (read before touching animation)

Polygon Mini Fantasy Characters is a **mesh/rig pack only** — it ships zero animations of its own, and neither Sidekick animation pack (`AnimationBaseLocomotion`, `AnimationSwordCombat`) has a "Mini" rig variant. Animating a Mini Fantasy character always means retargeting from the Sidekick clips. Both rigs happen to use identical bone names, but **each bone's rest orientation is different between the two rigs** (confirmed by comparing rest matrices directly in Blender) — copying a `rotation_quaternion` curve by bone name without correcting for that produces a T-pose baseline, unstable attack swings, and similar symptoms. `tools/convert_synty_depthbreaker.py` handles this with two Blender-side steps, both baked into the exported GLB once (never as runtime/client-side per-bone hacks — that approach was tried and abandoned mid-session because it doesn't generalize and stacks fragile special cases):

1. **`retarget_rotation_curves`** — a generic change-of-basis retarget applied to every bone: for each bone, `delta = targetRestQuat^-1 * sourceRestQuat` (computed once from each rig's own rest pose), then every keyframe `q` becomes `delta * q * delta^-1`. This is the standard retargeting formula (conjugation, not a plain multiply — verified by checking that an identity/no-rotation source pose maps back to identity in the target frame).
2. **`apply_shoulder_relaxed_corrections`** — a separate, smaller fix for a real content gap: Sidekick's base-locomotion clips only carry a *small* delta off their own rest pose for the arms, because the "arms relaxed at the sides" pose normally comes from a separate additive layer in Unreal's animation blueprint that this pipeline has no access to. This bakes a fixed per-character correction (derived from each character's own rest-pose arm geometry, not a hand-picked constant) that rotates the shoulder to a natural hanging position, applied after the retarget so it composes correctly with whatever the clip itself is doing.

Rule: **any new correction belongs in the Blender conversion script, computed from the rig's own data, never as a per-bone client-side override in `AnimatedCharacter.tsx`.** The client should only ever need to drive whatever the mixer produces uniformly — if a character looks wrong, the fix is almost always upstream in the GLB, not downstream in React.

**Weapon attachment rule:** this rig carries an internal ~0.01 armature-level scale (bone-local coordinates are large raw numbers compensated by that scale). The character's own skinned mesh isn't affected (skinning uses inverse bind matrices), but a plain weapon mesh parented onto a hand bone via `createPortal` has no such compensation and inherits the bone's tiny real world scale directly. `HeldWeapon` in `AnimatedCharacter.tsx` counter-scales both `weaponTransform.scale` and `weaponTransform.position` by the hand bone's actual `getWorldScale()` before applying the authored values, so those values mean "relative to the character's own visible size," not "raw bone-local units." When authoring a new `weaponTransform.rotation`, derive it the same way this session did — compute the target world-space direction you want the weapon's long axis to point (e.g. continuing the forearm's own direction for a sword, or straight up for a staff), convert to the hand bone's local space, and solve with `Quaternion.setFromUnitVectors` — not by guessing Euler angles and eyeballing a screenshot.

#### Importing a new Synty character

1. Place its source FBX under `Source_Files/Characters/` (and make sure its animation packages are extracted into `_restored/`), matching the existing layout.
2. Add it to the `CHARACTERS` list in `tools/convert_synty_depthbreaker.py`, then run that script via Blender as shown above (quoted, forward-slash paths). The export must keep using `export_animation_mode="NLA_TRACKS"` — the default `"ACTIONS"` mode bakes cross-clip contamination when multiple clips are NLA-stashed onto one armature. The retarget and shoulder-relaxed correction (see above) run automatically for every character and every bone; there's nothing character-specific to configure.
3. Add a `characters[]` entry to `client/public/models/synty/runtime/manifest.json` (`key`, `url`, `requiredClips`, `visualHeight`, `radius`, `fallback`, `runtimeApproved: false`).
4. Run `npm run validate:assets` until it passes clean; it also writes `naturalHeight`/`restMinY` into that entry as a side effect — don't hand-edit those two fields, they're re-derived from the GLB every run.
5. Flip `runtimeApproved: true` for the new entry.
6. Register the character in `client/src/game/actors/useModel.ts` (`SYNTY_DEPTHBREAKER_MODELS` plus `PLAYER_MODELS`/`ENEMY_MODELS` as appropriate) — `AnimatedCharacter.tsx` will use the manifest's `naturalHeight`/`restMinY` automatically once present, instead of measuring the mesh at runtime.
7. Run `npm run typecheck`, `npm test -- --run`, `npm run validate:assets`, `npm run build --workspace client`, then check it in the browser before relying on it — verify numerically first (bone directions via a small Node/three.js script sampling world-space positions across the clip timeline, the same technique used throughout this pipeline's development) rather than shipping on a visual guess.

#### Combat animation contract

`client/src/game/actors/useCombatAnimState.ts` is the single source of truth for how a character's visual state is derived — both `AnimatedCharacter.tsx` (GLB) and `ProceduralCharacter.tsx` (placeholder) consume it, and any future renderer should too rather than inventing its own timing. It reduces movement speed plus `combatBus` events into one of five states (`idle | run | attack | hit | death`), each frame, via `update(delta, loco?)`. Attack/hit windows are timed off `combatBus` events (`delayMs` plus either the GLB clip's own duration or a fixed ~400ms default for the procedural renderer). Renderers must not add their own parallel state machine or bespoke per-bone timing on top of this — if a class/enemy needs a visual variation, it belongs in the appearance tables (`useModel.ts` / `proceduralCharacters.ts`), not in new animation-state logic.

#### Locomotion rule (why the walk used to look bad)

Movement speed that drives the animation must come from the **rendered mesh's own interpolated world-position delta**, not from raw network snapshots — `client/src/game/actors/useLocomotion.ts` (ported from world-of-claudecraft) does this with enter-speed + hold-time hysteresis and an EMA. `AnimatedCharacter` samples its own group each frame and passes the result into `useCombatAnimState.update(delta, loco)`. Sampling the raw 20 Hz snapshot instead gives a staircase that disagrees with the smooth visible motion and makes the walk clip flip/reset.

The locomotion clip's playback rate is **foot-speed-matched**: `AnimatedCharacter.resolveTimeScale` sets `timeScale = worldSpeed / (naturalClipSpeed * rootScale)`, clamped, so the churning legs keep pace with how fast the body travels. The Mini Fantasy clips are chibi-proportioned and advance only ~0.3–0.5 world u/s of stride, so `PLAYER_SPEED` (and enemy `moveSpeed`) were tuned down from 6 to keep the mismatch small; the two `NATURAL_*_UNITS_PER_S` constants are measured offline (foot peak-to-peak excursion / clip period) and shared because all five runtime characters reuse the same two Sidekick clips. If a character ever gets its own locomotion clip, re-measure those. **Do not** "fix" locomotion with per-bone client overrides — the leg swing itself is healthy (~45°); the only lever is speed vs. playback rate.

#### Cosmetic skins

`SYNTY_SKINS` in `useModel.ts` lists the Polygon Mini Fantasy recolor atlases (red/blue/green/purple/yellow, all sharing the base UV). A model's optional `skinUrl` is swapped onto every `MeshStandardMaterial.map` at runtime by `AnimatedCharacter` (set `flipY=false`, sRGB to match the glTF-embedded atlas). Player classes are recolored per class so the shared warrior/mage rigs read as distinct; extend into a picker UI later if wanted.

#### Roadmap — further ideas worth porting from world-of-claudecraft

Ranked by value/effort for a future pass (not yet implemented):
1. **Backpedal + turn-in-place** — a reverse-playback walk for moving backward and a `clickMoveShouldWalk`-style turn cone so characters pivot before striding. Low effort, good feel; needs a `backwards` flag (already computable in `useLocomotion`) and a click-move tweak.
2. **Distance-tiered mixer throttling** — update far-away characters' `AnimationMixer` every Nth frame (state edges still latch immediately). Low effort, real CPU win once many enemies are on screen.
3. **Camera-follow easing** — WoCC's `camera_follow.ts` smooths chase-camera yaw with an eased settle and a slower click-to-move curve. Medium effort, noticeably smoother camera.
4. **Auto-attack swing-timer + GCD combat** — WoCC's melee/ranged swing timer and ability GCD model. High effort (touches `packages/sim`), but the biggest depth upgrade to combat feel.

#### Map rule

`packages/protocol/src/mapGen.ts`'s `buildDungeon(seed, depth)` is the single shared source of truth for dungeon layout, spawns, and walkable collision. It turns the seeded room graph from `@depthbreaker/sim` (`dungeonGraph.ts`, frozen golden vectors — do not modify) into a world-space `DungeonMapDefinition`. The run seed is already synced (backend → join ticket → `ZoneState.seed` → client snapshot), so the realtime server (`ZoneRoom` builds `this.dungeon` on first join) and the client (`RuntimeDungeon`/`DungeonClickPlane` rebuild from `snap.seed`/`snap.depth`) call the same pure function and get byte-identical geometry — no map is sent over the wire. `DEPTHBREAKER_DUNGEON` in `map.ts` is now just a fixed-seed fallback for the `map =` default params on `isPointInRect`/`isDungeonWalkable`. To change how dungeons generate, edit `buildDungeon` (grid→world mapping, room-kind→spawn rules, prop templates), never per-renderer.

## Tests & typecheck

```powershell
npm run typecheck            # all workspaces (tsc --noEmit)
npm test                     # sim + backend; backend DB suites need TEST_DATABASE_URL
```

## Verification (last run 2026-07-03, this machine)

| Check | Result |
|---|---|
| Workspace `npm install` | OK |
| `@depthbreaker/sim` typecheck + 30 vitest | OK |
| `@depthbreaker/protocol` typecheck | OK |
| backend typecheck + tests (Postgres in Docker) | OK 21/21 |
| realtime typecheck | OK |
| realtime boot + headless join/move/**combat kill -> +50 XP** | OK end-to-end |
| client typecheck (`tsc --noEmit`) | OK |
| client in browser: WebGL scene renders, joins zone, live combat | OK HUD showed room + players + enemies, HP ticking from enemy hits |
| full backend chain from the page (guest -> character -> run ticket) | OK all 201, real join ticket issued |

## Launch status

**Blocked.** No public link may be shared: the Solana/Pump.fun layer (SIWS auth,
finite seasonal pool, payment intents, payouts, mainnet canary) is Phase 2 -- see
design doc Appendix A (integration path) and Appendix B (blocker list).
`payout_mode: disabled`, `PAYOUT_KILL_SWITCH=true` are the standing defaults.
