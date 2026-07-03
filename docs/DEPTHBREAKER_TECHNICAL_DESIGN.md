# Depthbreaker — Technical Design (Unity WebGL 3D Multiplayer Roguelike, MMO-Lite)

Revision 1.0 — 2026-07-03. This document is the revised, decision-locked version of the original research blueprint. It removes surveyed-but-rejected options into a decision log, corrects details against verified vendor documentation, and adds the Tortoise Games compliance layer. The Phase 0 implementation lives in `games/depthbreaker/`; the filled launch spec is `games/depthbreaker/GAME_LAUNCH_SPEC.md` (currently **launch blocked**).

## 1. Overview & Pillars

Depthbreaker is a browser-playable 3D multiplayer action roguelike:

- **Hades loop:** seeded dungeon runs; die → keep meta-currency and permanent upgrades → run again stronger. Run level (1–30), run items, buffs, and depth reset each run.
- **MMO-lite shell:** a persistent shared hub (later, three shared overworlds gated at levels 10/20/30) where players see each other in real time.
- **Server-authoritative everything that matters:** because progression persists, XP, loot, currency, item stats, and combat outcomes are computed only on the server. The client predicts movement and renders; it never decides.

Target platform: desktop browsers first (Chrome/Firefox/Edge/Safari), WebGL2, mid-range laptop performance budget. Session shape: 15–30 minute runs, drop-in hub visits.

## 2. Decision Log

| # | Decision | Chosen | Rejected alternatives | Rationale |
|---|---|---|---|---|
| D1 | Netcode framework | **FishNet 4.x** | Mirror (fewer prediction features), Unity NGO (fiddly WebGL/WSS), Photon Fusion (managed, $ at scale, weaker fit for persistent authority), PUN2 (LTS/legacy), Colyseus (sim would leave Unity), SpacetimeDB (young, BSL license) | Free, open source, built-in client-side prediction v2 and interest management, maintained WebSocket transport |
| D2 | WebGL transport | **Bayou (WebSocket/wss)** | FishyWebRTC/CanoeWebRTC (UDP-like, but immature; not testable in-editor) | Browsers forbid raw sockets; wss is the production-proven path. Target-based combat tolerates TCP. Revisit WebRTC only if movement feel fails after prediction tuning |
| D3 | TLS for wss | **nginx reverse-proxy termination; Bayou runs plain ws behind it** | In-Unity certificates (Bayou `Use WSS` + cert path) | Cert management inside Unity builds is painful and rotation-hostile; both FishNet and Mirror docs recommend a reverse proxy |
| D4 | Server tick | **30 Hz** (FishNet `TimeManager.TickRate`) | 10–20 Hz (cheaper, floatier), 60 Hz (waste for target combat) | Balance of responsiveness vs CPU/bandwidth for non-twitch combat; matches Nakama's 30 Hz authoritative ceiling for later services |
| D5 | Simulation host | **Headless Unity Linux dedicated server** (`UNITY_SERVER` define / batch mode) | Client-host or relay (cheatable with persistent progression); rewriting sim in TS (double implementation) | Shared C# sim code between client prediction and server truth |
| D6 | Durable backend | **Separate Node/TypeScript (Fastify) service + PostgreSQL** | Nakama (strong option, but adds an ops dependency before it pays for itself; revisit for matchmaking/social at Phase 1+), backend inside Unity (account data must survive zone restarts) | Zone servers stay stateless and disposable; accounts survive redeploys |
| D7 | Redis | **Deferred** | Redis for sessions/cache in Phase 0 | Access tokens are stateless JWTs; one zone process needs no shared presence. Reintroduce for multi-zone presence, matchmaking queues, and refresh-token revocation fan-out |
| D8 | Auth | **Guest-first + email/scrypt; JWT access in memory + rotated opaque refresh token in HttpOnly cookie** | OAuth social login (deferred); device-unique-ID guests (unreliable in browsers) | Lowest-friction browser onboarding; token storage per OWASP (no localStorage) |
| D9 | Armor model | **Ratio: `DR = armor/(armor+K)`, cap 75%** | Subtractive `dmg − armor` (breaks at low levels, negates small hits) | Smooth diminishing returns, never zero/negative, scales L1–30 |
| D10 | Run vs account progression | **Run axis resets (level 1–30, items, buffs, depth); account axis persists (meta-currency, upgrade tree, unlocks, history)** | Fully persistent level (pure MMO), fully resetting everything (pure roguelike) | The Hades retention loop; a persistent "mastery" level remains a Phase 1 experiment |
| D11 | Math ownership | **C# zone server is runtime-authoritative; TS backend plausibility-checks reports; both bound to `shared-spec/GAME_MATH_SPEC.md` + golden vectors** | Backend re-simulating runs (double implementation, drift) | One spec, two conforming implementations, cross-language test vectors |
| D12 | Solana/token layer | **Deferred to Phase 2**; seams designed now (Appendix A) | Wiring token economy into Phase 0 | User decision: core game first. Off-chain `meta_currency` has no real value, so Phase 0 risk is contained |
| D13 | Hosting | **VPS (e.g. Hetzner) for persistent hub/zones; container orchestration (e.g. Edgegap) for instanced runs at scale** | Hathora (shut down May 2026), Unity Multiplay (support ended March 2026) | Flat predictable cost + pay-per-use scaling; egress is the cost to watch (30–50% of bills at scale) |
| D14 | Client stack | **Unity 6 LTS, URP Forward, WebGL2, Addressables streaming, Brotli (+ gzip fallback)** | URP Deferred (needs SM4.5, no WebGL), WebGPU (experimental), built-in RP | Unity's own recommendation for web; WebGL memory/threading constraints (§8) |

## 3. Architecture

```
[Browser: Unity WebGL client]
   │ wss://host/game  (FishNet + Bayou)     │ https://host/api  (REST, JWT)
   ▼                                         ▼
[nginx: TLS termination, static WebGL hosting]
   │ ws://zone:7770                          │ http://backend:3000
   ▼                                         ▼
[Headless Unity Linux zone servers]   [Node/Fastify backend]
   - Hub zone (persistent)               - auth (guest/email, JWT+refresh)
   - Instanced dungeon runs              - characters, runs, meta-progression
   │  POST /internal/* (shared secret)   - /api/health (fails closed)
   └────────────────────────────────────►│
                                          ▼
                                    [PostgreSQL 16]
```

**Trust boundaries.**

1. *Client → zone server:* inputs and requests only (movement input structs, `SetTarget`, `UseSkill`, interact). The server validates all of them; the client is display + prediction.
2. *Client → backend:* authenticated REST. Wallet/account identity always derives from the verified token/cookie, never from a request body.
3. *Zone server → backend:* the only writer of run results, via `/internal/*` with a `ZONE_SHARED_SECRET` bearer header (constant-time compare). Clients cannot reach `/internal/*` (nginx does not route it).
4. *Backend → DB:* the only component with DB credentials. Zone servers hold no durable state; killing one loses at most the current run's unsaved progress.

**Join-ticket sequence** (how a client gets into a zone without the zone server trusting it):

```
Client                Backend                       Zone server
  │ POST /api/runs/start │                              │
  │─────────────────────►│ create runs row (seed)       │
  │                      │ sign join ticket:            │
  │                      │  HS256(ZONE_SHARED_SECRET)   │
  │                      │  {sub, cid, rid, seed, 60s}  │
  │◄─────────────────────│ {run_id, seed, ws_url,       │
  │                      │  join_ticket}                │
  │ wss connect + JoinBroadcast{ticket}                 │
  │────────────────────────────────────────────────────►│
  │                      │        verify HMAC locally   │
  │                      │        (no backend roundtrip)│
  │◄────────────────────────── spawn player, run begins │
  ...on death/clear...   │◄── POST /internal/runs/:id/finish (shared secret)
```

The ticket is a 60-second HS256 JWT. The zone server verifies signature + expiry with `System.Security.Cryptography.HMACSHA256` (no JWT library needed) and learns the account, character, run id, and seed from the claims.

## 4. Netcode (verified against FishNet 4.x documentation)

### 4.1 Transport reality

Browsers do not allow raw TCP/UDP sockets; all real-time traffic is WebSocket (TCP). TCP brings head-of-line blocking, so the design leans on:

- **Send inputs, not positions.** Client sends `{tick, moveDir}`; server owns resulting positions.
- **Client-side prediction + server reconciliation** for the local player.
- **Entity interpolation** (~100 ms buffer) for remote players and enemies.
- **Target-based combat** (no aim-dependent hits), which hides latency by design.

Pages served over https can only open `wss://` — TLS is mandatory in production and handled by nginx (D3).

### 4.2 Prediction v2 pattern (the shape every predicted object follows)

Verified against FishNet's prediction docs:

- Input struct implements `IReplicateData`, state struct implements `IReconcileData`; both carry `private uint _tick` plus `GetTick()/SetTick()/Dispose()`.
- `[Replicate] private void RunInputs(MoveInput data, ReplicateState state = ReplicateState.Invalid, Channel channel = Channel.Unreliable)` — runs on owner (predicting) and server (authoritative), and replays on reconcile.
- `[Reconcile] private void ReconcileState(MoveReconcile data, Channel channel = Channel.Unreliable)` — server sends authoritative state; client rewinds and replays unacknowledged inputs.
- Subscribe to `TimeManager.OnTick` (gather input, call replicate) and `TimeManager.OnPostTick` (call `CreateReconcile()`).

The Phase 0 motor is kinematic (CharacterController-style), not rigidbody: cheaper on WebGL and deterministic enough for ground movement.

### 4.3 Tick, interest management, bandwidth

- `TimeManager.TickRate = 30` (D4), set on the NetworkManager prefab and asserted in `ZoneServerBootstrap`.
- **Interest management:** FishNet `ObserverManager` with a `GridCondition` asset (conditions are ScriptableObject assets assigned in the inspector — documented in `unity/SETUP.md`, not fakeable in code). Players receive updates only for entities in nearby grid cells; this bounds bandwidth and also gates enemy AI ticking (§6.4).
- Remote entities render behind by the interpolation buffer; distant objects can drop to lower sync rates in Phase 1 if profiling demands it.

### 4.4 Zones and instances

- **Hub:** one persistent shared scene per zone process.
- **Dungeon runs:** instanced — Phase 0 runs one instance per process (simplest possible ops); Phase 1 moves to FishNet scene stacking or process-per-run containers on the orchestrator. Zone handoff = disconnect from A, obtain new ticket, connect to B; the backend carries all durable state between zones.

## 5. Gameplay Systems

All formulas below are normative in `games/depthbreaker/shared-spec/GAME_MATH_SPEC.md` with golden test vectors in `shared-spec/vectors/`. The TS reference implementation (`backend/src/sim/`) is tested against the vectors in CI-able vitest; the C# mirrors (`unity/Assets/Scripts/Shared/`) carry the same vector bindings (C# test execution deferred until a Unity-capable machine).

### 5.1 Combat

- **Targeting:** click → raycast → `[ServerRpc] SetTarget(entityId)`; server validates existence, faction, observability.
- **Auto-attack:** server-side per-entity timer from `ClassDefinition.attackInterval`; on elapse the server checks target alive + in range + line of sight (Phase 1), rolls damage, broadcasts.
- **Skills:** 2 per class; `[ServerRpc] UseSkill(index)`. Server validates: known skill, cooldown elapsed, GCD (1.0 s) elapsed, resource available, target in range. Cooldowns are flat across levels; power comes from stats (easier to balance).
- **Damage:** `DR = armor / (armor + 100 × attackerLevel)`, capped at 0.75; `final = max(1, round(raw × (1 − DR)))`; crit multiplies raw by 1.5 before mitigation. (WoW-derived ratio model, D9.)
- **Classes (data-driven `ClassDefinition` assets):**
  - **Bruiser** (melee): Cleave (frontal arc, 6 s), Bulwark (self-shield, 12 s).
  - **Mage** (ranged): Fireball (single-target burst, 4 s), Frost Nova (AoE root/slow, 14 s).
  - **Warden** (hybrid/support): Mend (heal self/ally, 8 s), Empower (ally damage buff, 16 s).
  No strict tank/healer/DPS trinity — every class must solo a run.

### 5.2 Stats & XP

- Stats: HP, Attack, Armor, AttackSpeed, CritChance, CritDamage, resource. Aggregated as `base + perLevel × (level−1) + item modifiers` (`StatBlock`).
- XP: `XpToNext(L) = round(100 × L^2.2)`, levels 1–30. The canonical values are a frozen 29-entry table in the math spec (generated once from the formula) so cross-platform `pow` rounding can never desync client, server, and backend. Polynomial, not exponential — 30 exponential levels explode too fast to pace three worlds.

### 5.3 Enemy AI (server-only)

- **FSM:** `Idle → Aggro → Combat → Leash → Reset`. Event-driven wake (proximity scan on a slow cadence while Idle), full ticking only in Aggro/Combat.
- **Threat:** damage adds 1.0/point, healing adds 0.5/point split across enemies in combat with the healer; overheal adds none. Target swaps only past **110%** of current target's threat in melee range, **130%** beyond it (prevents flip-flopping). Taunt (Phase 1) sets threat to top + forced target.
- **Leash:** distance-based, 40 m from spawn. On leash: clear threat, become invulnerable, return to spawn, full heal, Reset → Idle. (Retail WoW's exact behavior is disputed/timer-based; distance is the simpler, standard choice.)
- **Perf:** AI ticks only for enemies with ≥1 observer (AOI-gated); spawners pool instances. Load-test rather than trusting any published FSM-scale figure.

### 5.4 Procedural dungeons

- **Room-graph, Isaac-style adapted to 3D:** seeded random walk on a 2D grid — start room at origin; repeatedly pick a random existing room and a random direction, place a room if the cell is free, until `roomCount` reached. Connectivity is guaranteed by construction. Boss room = max-BFS-distance room from start (deterministic tie-break); treasure room = seeded pick among remaining dead-ends.
- **Server-authoritative seed:** the backend issues the seed at `/api/runs/start` and stores it on the run row; the zone server generates the graph and network-spawns room prefabs; clients rebuild locally from the same seed for geometry-only concerns. Determinism holds because the RNG is a specified 32-bit algorithm (§5.6), not `System.Random`/`Math.random`.
- Rooms realize as purchased modular prefabs listed in `RoomTemplateDefinition` assets.

### 5.5 Loot

Server-only rolls on kill: drop chance → rarity (weighted: common 60 / uncommon 25 / rare 10 / epic 4 / legendary 1) → item template → per-stat integer rolls within template ranges. Results stored on the run (`runs.loot` jsonb) and granted to the killer's run inventory (SyncList to the owner). Run-scoped items purge on death; account-scoped items are a Phase 1 decision.

### 5.6 Deterministic RNG (cross-language contract)

`DeterministicRng` is splitmix32: state advances by `0x9E3779B9`, output is the 2-round mix specified in the math spec. Implemented bit-identically in TS (`Math.imul`) and C# (`uint`). Substreams derive as `streamSeed = mix(seed32 XOR streamId × 0x9E3779B9)` so loot, layout, and spawn rolls never share a sequence (one system consuming a roll can't shift another's). This is what makes golden vectors and client-side geometry rebuilds possible.

## 6. Meta-progression & Run Lifecycle

| Persists (account axis) | Resets (run axis) |
|---|---|
| Meta-currency | Run level (1–30) |
| Upgrade-tree ranks (respec-friendly) | Run items / rolled gear |
| Class/skill/cosmetic unlocks | Temporary buffs |
| Run history & stats | Dungeon depth/progress |

**Run state machine** (server + backend):

```
hub → POST /api/runs/start (run row: active, seed) → play
  ├─ death  → zone server finalizes → POST /internal/runs/:id/finish
  │            {outcome: dead, depth, xp_earned, currency_earned, loot}
  ├─ clear  → same with outcome: complete
  └─ disconnect timeout → outcome: abandoned (currency still credited)
backend: validate plausibility → credit meta_wallets (transactional)
       → write run history → client returns to hub → spend → next run
```

Meta-currency is earned **even on death** — the core roguelite retention hook (Hades' Mirror requires 35k+ Darkness at the long tail; our tree should have a comparable slow-burn sink). As permanent power grows, Phase 1 adds a Pact-of-Punishment-style optional difficulty scale so meta power doesn't trivialize runs.

**Plausibility validation:** the backend does not re-simulate. It rejects (`422`) reports where `xp_earned > maxXpForDepth(depth)` or `currency_earned > maxCurrencyForDepth(depth)` (functions in the math spec). This bounds the blast radius of a compromised zone secret and catches server bugs; the real authority is that only zone servers hold the shared secret.

## 7. Backend & Data Model

Fastify 5 + `pg` + `jose` + `@fastify/cookie`; passwords via `node:crypto` scrypt (no native builds). Reuses `shared/lib/config.ts` (env helpers, `ProductionReadinessError`) by relative import.

### 7.1 Endpoints

```
POST /api/auth/guest             create guest account → tokens
POST /api/auth/register|login    email + scrypt
POST /api/auth/refresh           rotate refresh cookie, new access JWT
POST /api/auth/logout            revoke refresh family
GET|POST /api/characters         list/create (name, class)
GET  /api/characters/:id
POST /api/runs/start             → { run_id, seed, ws_url, join_ticket }
GET  /api/runs/history?character_id=
GET  /api/meta                   → { currency, upgrades, unlocks }
POST /api/meta/spend             { upgrade_id } transactional rank purchase
GET  /api/health                 fails closed (503) when misconfigured
--- internal, Bearer ZONE_SHARED_SECRET ---
POST /internal/runs/:id/finish
POST /internal/characters/:id/checkpoint
```

### 7.2 Auth details

- **Access token:** HS256 JWT (`SESSION_SECRET`), 15 min, claims `{sub}`; held in client memory only (WebGL `SessionState`), never persisted — per OWASP guidance against localStorage tokens.
- **Refresh token:** 256-bit random, stored **hashed** (SHA-256) in `refresh_tokens` with a `family` id; delivered as `db_refresh` HttpOnly+Secure+SameSite=Lax cookie scoped to `/api/auth`; **rotated on every refresh; reuse of a rotated token revokes the whole family** (stolen-cookie containment). Guest lifetime 30 d, email 7 d.
- **Guest → email upgrade:** `register` while authenticated upgrades the current account in place (keeps progress).

### 7.3 Schema (`backend/migrations/0001_init.sql`)

```sql
accounts(id uuid PK, kind guest|email, email unique null, password_hash null,
         created_at, last_login_at)
refresh_tokens(id PK, account_id FK, token_hash unique, family uuid,
               expires_at, rotated_at, revoked_at)
characters(id PK, account_id FK, name, class_id, created_at, deleted_at)
meta_wallets(account_id PK/FK, currency bigint CHECK ≥0, updated_at)
meta_upgrades(id text PK, title, max_rank, cost_per_rank bigint[], prereq_id,
              effect jsonb)                      -- static catalog, seeded
account_upgrades(account_id, upgrade_id, rank, PK(account,upgrade))
account_unlocks(account_id, unlock_id, unlocked_at, PK(account,unlock))
runs(id PK, character_id FK, seed bigint, status active|dead|complete|abandoned,
     depth_reached, xp_earned, currency_earned, loot jsonb, started_at, ended_at)
inventory_items(id PK, character_id FK, base_item_id, rarity, rolled_stats jsonb,
                acquired_run_id, created_at)     -- schema ready; Phase 0 writes run summaries
schema_migrations(version PK, applied_at)
```

Currency mutations run inside transactions with `SELECT ... FOR UPDATE` on the wallet row. Run finish is idempotent: finishing a non-`active` run is a no-op `409`.

## 8. Client: WebGL Constraints, Input, Camera

- **Memory:** keep the heap small and fixed-ish; automatic heap growth can crash when the browser can't allocate a contiguous block. Budget low-hundreds of MB live heap; stream worlds with Addressables; never ship all zones in the initial `.data`.
- **No C# threads** on WebGL (no `System.Threading`, timers included); GC runs only at frame end — avoid per-frame allocations, pool aggressively, use `NativeArray` for scratch buffers.
- **Rendering:** URP Forward (Deferred unsupported on WebGL), GPU instancing for repeated enemies/props, hard AOI cap on visible players. Brotli with gzip fallback (some hosts, e.g. itch.io, lack Brotli).
- **Input** (new Input System): WASD → per-tick `MoveInput` struct (§4.2); click → raycast targeting; hold-drag orbit camera (yaw/pitch/zoom), purely client-side, never networked.
- **CORS:** backend sets explicit `Access-Control-Allow-Origin` from `CORS_ORIGIN`; wss + TLS + CORS configured **first** — it is the top "works in editor, fails in browser" trap.

## 9. Infrastructure & Deployment

- `infra/docker-compose.yml`: `postgres:16`, backend (node:22, tsx), nginx (TLS, static WebGL, `/api` proxy, `/game` WebSocket upgrade → zone 7770). The zone-server service ships commented until a Linux headless image exists.
- Local dev on Windows: run Postgres via Docker or natively; backend `npm run dev`; Unity Editor as client; a second Editor/build as server (Bayou plain ws, no TLS locally).
- Headless server builds: Unity Dedicated Server target (`UNITY_SERVER`), `-batchmode -nographics`, port/backend URL/secret from env or CLI args.
- Production: VPS for hub + persistent zones; per-run containers at scale (D13). Egress is the dominant scaling cost — meter it from day one.
- **Deployment class per Tortoise rules:** this is an always-on WebSocket game ⇒ long-running workers, **not** Vercel serverless (AGENTS.md Production Defaults).

## 10. Tortoise Games Compliance Notes

Mapping to `AGENTS.md` guardrails (Phase 0 status):

| Guardrail | Status |
|---|---|
| 1 Finite seasonal pool | N/A in Phase 0 (no real token). Designed: Appendix A wires meta-currency earning to `createEconomyEngine` settle. |
| 2 Spend split (40/40/20) | N/A Phase 0; spec'd for Phase 2 token spends (`GAME_LAUNCH_SPEC.md` §2). |
| 3 Server calculates everything | **Met.** All power/economy values server-computed (zone server + backend). |
| 4 Client never decides | **Met.** `client_authoritative_fields: none`; inputs/requests only. |
| 5 SIWS login, no token transfer | Deferred; Phase 0 JWT auth uses the same cookie-session shape so SIWS slots in without handler changes. |
| 6 Identity from session, not body | **Met.** All handlers derive account from verified JWT/cookie/ticket. |
| 7 Payment intents + on-chain verify | Deferred (no payments exist). |
| 8 Replay rejection | **Met in spirit now** (refresh rotation + family revoke; idempotent run finish); tx-signature uniqueness lands with payments. |
| 9 Payout caps/idempotency/kill switch | `payout_mode: disabled`, `PAYOUT_KILL_SWITCH=true` defaults documented. |
| 10 `/api/health` before links | **Met.** Fails closed 503 via `ProductionReadinessError`. |
| 11 Mainnet canary | Deferred; blocked with Solana layer. |
| 12 No financial promises | Marketing copy rule recorded in launch spec. |

Missing shared modules (`shared/lib/auth.ts`, `db.ts`, `payment.ts`, `token-gate.ts`, `api.ts`) are **not claimed as wired** — they are launch blockers (Appendix B). Depthbreaker's backend implements game-local equivalents; extracting them into `shared/lib/` is Phase 2 work.

## Appendix A — Solana Integration Path (Phase 2, zero-rework seams)

1. **SIWS auth:** add `auth_nonces` table + `POST /api/auth/siws/{nonce,verify}`; a verified wallet signature creates/links an account (new `accounts.wallet` column, unique). The session cookie/JWT shape is unchanged — every existing handler keeps working. Guest/email accounts can link a wallet later (upgrade-in-place, same as guest→email).
2. **Finite pool earning:** replace the flat `currency_earned` credit in `/internal/runs/finish` with `createEconomyEngine(...).settle(...)` from `shared/lib/economy.ts`: player `power` from the launch-spec formula (all inputs already in `runs`/`account_upgrades`), emission debits the season pool. `meta_wallets` becomes the pool-backed balance; a `ledger` table records every credit.
3. **Token spends:** `payment_intents` table + server-created intents per `docs/CODEX_PATTERNS.md` pattern 3; on-chain verification via `shared/lib/solana-lite.ts` `rpcCall`; every spend applies `burnSplit` (40/40/20) and rejects reused signatures via unique index.
4. **Token gate:** server-side balance check (pattern 4) on `earn_gate`/`withdraw_gate` in run-finish and payout paths.
5. **Payouts:** `payout_requests` table, `REWARDS_PAYOUTS_ENABLED=false` default, `PAYOUT_KILL_SWITCH=true`, `MAX_PAYOUT_PER_CLAIM`/`DAILY_PAYOUT_CAP`, signer key server-side only, manual mainnet canary before enabling anything (PUMPFUN_LAUNCH.md phases 5–7).
6. **Health:** extend `/api/health` with RPC/mint/treasury checks (pattern 6).

## Appendix B — Launch Blockers (current)

1. All `TBD` fields in `GAME_LAUNCH_SPEC.md` §3 (token mint, RPC, treasury) and §5 (payout caps, canary).
2. Missing shared modules per AGENTS.md: `shared/lib/auth.ts` (SIWS), `db.ts`, `payment.ts`, `token-gate.ts`, `api.ts`.
3. Unity project not yet compiled anywhere. The pure-C# `Shared/` math passed the full golden-vector conformance run under .NET (174 checks) but the FishNet-dependent code is compile-unverified (see `games/depthbreaker/README.md` "Delivered unverified").
4. No headless Linux server image built; compose zone service commented out.
5. No mainnet canary (blocked on 1–2).
6. `/api/health` passes only the Phase 0 checks; Solana checks not yet implemented.

## Appendix C — Phase Roadmap

- **Phase 0 (this scaffold):** 1 class playable pattern, hub + one instanced run, prediction/interpolation, target combat, enemy FSM, seeded procgen, loot, death→hub loop, guest auth, persistence, health endpoint.
- **Phase 1:** all 3 classes tuned, World 1 built, party co-op runs, taunt, run history UI, Nakama-or-custom matchmaking decision, mastery-level experiment (D10), difficulty pact, leaderboards.
- **Phase 2:** Solana layer (Appendix A), shared module extraction, canary, launch per PUMPFUN_LAUNCH.md.
- **Phase 3:** Worlds 2–3, zone handoff, orchestrated per-run containers, load testing, egress optimization, mobile-browser tuning.
