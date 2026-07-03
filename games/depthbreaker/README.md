# Depthbreaker

Web 3D multiplayer roguelike (MMO-lite): Hades-style runs that reset on death,
an account axis (meta-currency, permanent upgrade tree) that persists, and a
shared hub with real players. Fully server-authoritative.

**Stack (web ecosystem):** React Three Fiber client · Colyseus authoritative
realtime server · Fastify + PostgreSQL backend · deterministic game math shared
as one TypeScript package. All TypeScript — no cross-language mirroring.

- **Design doc (normative):** [`docs/DEPTHBREAKER_TECHNICAL_DESIGN.md`](../../docs/DEPTHBREAKER_TECHNICAL_DESIGN.md)
- **Launch spec:** [`GAME_LAUNCH_SPEC.md`](GAME_LAUNCH_SPEC.md) — **LAUNCH BLOCKED** (Solana layer deferred to Phase 2)
- **Math contract:** [`shared-spec/GAME_MATH_SPEC.md`](shared-spec/GAME_MATH_SPEC.md) + frozen golden vectors in `shared-spec/vectors/`

## Layout (npm workspace)

```
packages/sim/       @depthbreaker/sim — deterministic math (RNG, combat, XP,
                    threat, loot, dungeon). Vitest-tested against shared-spec vectors.
packages/protocol/  @depthbreaker/protocol — Colyseus state schema, client<->server
                    message types, gameplay constants, plain view interfaces.
backend/            Fastify + pg + jose: auth (guest/email), characters, runs,
                    meta-progression, /internal reporting, /api/health.
realtime/           Colyseus authoritative server: ZoneRoom (movement, combat,
                    enemy FSM/threat), join-ticket auth, backend reporting.
client/             React Three Fiber (Vite): renders the synced zone, WASD move,
                    click-to-target, follow camera, HUD. Loads GLB asset packs.
infra/              docker-compose (postgres + optional nginx), TLS/wss guide.
shared-spec/        Language-neutral math spec + golden vectors.
unity/              SUPERSEDED by the web stack. Holds SETUP.md only; the
                    original Unity/FishNet C# scaffold was moved into a local
                    Unity project during early exploration and is not tracked here.
```

## Run it on localhost

From `games/depthbreaker/` (one `npm install` covers every workspace):

```powershell
npm install

# 1. Database (Docker) — or use a local Postgres and set DATABASE_URL
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Three dev servers, one per terminal:
npm run dev:backend     # Fastify  -> http://localhost:3000  (migrates on boot)
npm run dev:realtime    # Colyseus -> ws://localhost:2567
npm run dev:client      # Vite     -> http://localhost:5173

# 3. Open http://localhost:5173, pick a name + class, click Play.
```

The client tries the full backend flow (guest login → character → run start →
signed join ticket) and falls back to a ticketless dev join if the backend
isn't running, so the 3D scene works even with only the realtime server up.
Open the page in two tabs to see players share the hub in real time.

Controls: **WASD** move · **click an enemy** to attack (auto-attack is
server-side) · **right-drag** to look · **scroll** to zoom.

### Buying polygonal asset packs

The client renders primitive placeholders today. Asset packs load as **glTF/GLB**
(Kenney/Quaternius ship GLB directly; Synty POLYGON is FBX → convert in Blender;
Mixamo for character animations). Drop model URLs into the `MODELS` map in
`client/src/game/useModel.ts`; the renderer falls back to primitives when a slot
is empty, so you can add art incrementally.

## Tests & typecheck

```powershell
npm run typecheck            # all workspaces (tsc --noEmit)
npm test                     # sim + backend; backend DB suites need TEST_DATABASE_URL
```

## Verification (last run 2026-07-03, this machine)

| Check | Result |
|---|---|
| Workspace `npm install` | ✅ |
| `@depthbreaker/sim` typecheck + 30 vitest | ✅ |
| `@depthbreaker/protocol` typecheck | ✅ |
| backend typecheck + tests (Postgres in Docker) | ✅ 21/21 |
| realtime typecheck | ✅ |
| realtime boot + headless join/move/**combat kill → +50 XP** | ✅ end-to-end |
| client typecheck (`tsc --noEmit`) | ✅ |
| client in browser: WebGL scene renders, joins zone, live combat | ✅ HUD showed room + players + enemies, HP ticking from enemy hits |
| full backend chain from the page (guest → character → run ticket) | ✅ all 201, real join ticket issued |

## Launch status

**Blocked.** No public link may be shared: the Solana/Pump.fun layer (SIWS auth,
finite seasonal pool, payment intents, payouts, mainnet canary) is Phase 2 — see
design doc Appendix A (integration path) and Appendix B (blocker list).
`payout_mode: disabled`, `PAYOUT_KILL_SWITCH=true` are the standing defaults.
