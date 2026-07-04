# Depthbreaker

Web 3D multiplayer roguelike (MMO-lite): Hades-style runs that reset on death,
an account axis (meta-currency, permanent upgrade tree) that persists, and a
shared hub with real players. Fully server-authoritative.

**Stack (web ecosystem):** React Three Fiber client - Colyseus authoritative
realtime server - Fastify + PostgreSQL backend - deterministic game math shared
as one TypeScript package. All TypeScript -- no cross-language mirroring.

- **Design doc (normative):** [`docs/DEPTHBREAKER_TECHNICAL_DESIGN.md`](../../docs/DEPTHBREAKER_TECHNICAL_DESIGN.md)
- **Launch spec:** [`GAME_LAUNCH_SPEC.md`](GAME_LAUNCH_SPEC.md) -- **LAUNCH BLOCKED** (Solana layer deferred to Phase 2)
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

Current Synty conversion seed: `models/synty/` contains Mini Fantasy knight, warrior, wizard, skeleton, goblin chief, rock golem, sword, staff, and shield GLBs converted from `C:\Users\vlgp6\Projects\unity sheets\Source_Files`. `models/synty/depthbreaker/` is the candidate character set: Mini Fantasy meshes combined with compatible Sidekick animation clips named `idle`, `walk`, `run`, `attack`, `block`, `hit`, and `death`. Characters are only used at runtime after `client/public/models/synty/runtime/manifest.json` marks them `runtimeApproved`; until then KayKit is the fallback for stable gameplay.

The active dungeon is web-native and modular. `models/synty/dungeon/` contains the raw converted POLYGON Dungeon Realms kit. `models/synty/runtime/` contains the approved v1 runtime subset plus `manifest.json` with `visualScale`, `yOffset`, `collisionProxy`, and `runtimeApproved`. The client renders a compact combat-slice map from the shared `DEPTHBREAKER_DUNGEON` definition, and the realtime server uses that same definition for walkable collision, spawns, and the boss portal. Full Unity demo scenes are conversion references only, not runtime maps.

Validate the approved Synty runtime subset:

```powershell
npm run validate:assets
```

Repeat the current Synty Mini Fantasy conversion with Blender:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools\convert_synty_minis.py -- --source "C:\Users\vlgp6\Projects\unity sheets\Source_Files" --out client\public\models\synty
```

Build the runtime-ready Synty characters after extracting the Unity animation packages into `C:\Users\vlgp6\Projects\unity sheets\_restored`:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools\convert_synty_depthbreaker.py -- --source "C:\Users\vlgp6\Projects\unity sheets\Source_Files" --restored "C:\Users\vlgp6\Projects\unity sheets\_restored" --out client\public\models\synty\depthbreaker
```

Convert the curated Dungeon Realms kit:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python tools\convert_synty_dungeon_realms.py -- --restored "C:\Users\vlgp6\Projects\unity sheets\_restored" --out client\public\models\synty\dungeon
```

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
