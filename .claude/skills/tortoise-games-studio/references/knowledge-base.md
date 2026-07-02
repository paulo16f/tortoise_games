# Tortoise Games Knowledge Base

This reference compresses the Tortoise Games folder into skill-ready knowledge.

## Source Map

- `README.md`: repo purpose, current implementation status, Fable workflow, source links.
- `AGENTS.md`: entry rules for Claude Code and Claude Fable.
- `.claude/agents/web3-game-economy.md`: guardrail agent for economy and Solana launch review.
- `docs/FABLE_GAME_LAUNCH_SPEC.md`: spec Claude Fable must complete before generation or launch.
- `docs/ECONOMY_LAWS.md`: token economy invariants.
- `docs/CODEX_PATTERNS.md`: auth, DB, locks, payments, payouts, health, env, deployment patterns.
- `docs/PUMPFUN_LAUNCH.md`: operational Pump.fun/Solana launch manual.
- `shared/lib/economy.ts`: implemented finite-pool economy engine.
- `shared/lib/solana-lite.ts`: implemented minimal Solana RPC helpers.
- `shared/lib/config.ts`: implemented env helpers.
- `scripts/generate-session-secret.mjs`: implemented secret generator.

## Current Repo Truth

Implemented:

- `createEconomyEngine()` with `settle`, `burnSplit`, `resetSeason`, `poolStats`, `addGlobalPower`, `globalTotalPower`, `poolRemaining`.
- `rpcCall()`, `normalizePublicKey()`, `publicKeyBytes()`, `SPL_TOKEN_PROGRAM_ID`.
- `env()`, `hasEnv()`, `envNumber()`, `envBool()`, `envList()`, `ProductionReadinessError`.
- Documentation and skills.

Not implemented yet:

- `auth.ts` for SIWS/signed-message auth, nonces, sessions.
- `db.ts` for Postgres, migrations, advisory locks, idempotency.
- `payment.ts` for server-created SPL payment intents and Solana transaction verification.
- `token-gate.ts` for SPL holder checks.
- `api.ts` for fail-closed response helpers.
- `templates/` for game scaffolds.

Do not claim missing modules are already wired. Generate them or mark launch blocked.

## Creative Freedom

Fable can create any:

- genre or hybrid genre;
- theme, world, story, character system, map, zone, or quest;
- battle, idle, racing, farming, social, guild, strategy, RPG, card, puzzle, collection, or simulation loop;
- visual style or UI;
- progression system;
- token spend.

The examples in docs are examples only. They are not limits.

## Economy Invariants

### Finite Seasonal Pool

All real token rewards debit a finite pool.

```txt
SEASON_POOL = seeded token amount
EMISSION_RATE = SEASON_POOL / SEASON_DURATION_SECONDS
player_share = player_power / total_active_power
earned = min(EMISSION_RATE * elapsed_seconds * player_share, pool_remaining)
```

Rewards may look like loot, quests, racing prizes, boss drops, farming yield, guild rewards, card battles, or idle income. Under the hood, they must debit the finite pool.

Blocked:

- mint per kill, click, quest, or harvest;
- uncapped reward formulas;
- browser-only reward calculation.

### Spend Split

Every in-game token spend uses:

```txt
40% burn or burn-liability ledger
40% recycled into seasonal pool
20% treasury
```

If immediate on-chain burn is not implemented, track burn liability until a burn transaction executes.

### Server Is The Clock

State-changing handlers follow this order:

1. verify session;
2. derive wallet from session;
3. acquire lock;
4. load state;
5. settle rewards;
6. validate action;
7. mutate state;
8. save state and ledger.

Browser previews are allowed but non-authoritative.

### Gates And Caps

Every game needs:

- optional token gate;
- earn gate;
- withdraw gate;
- per-claim payout cap;
- daily payout cap;
- payout kill switch.

### Power

Reward share reduces to one server-side `power` number. The game may have many stats, but reward share uses one auditable value.

Examples:

- RPG: `gearScore + zoneLevel * 100 + bossKills * 5`
- Strategy: `territoryScore + unitPower + cappedRankBonus`
- Farming: `landTier * 100 + harvestScore + machineryPower`
- Racing: `carRating + trainingScore + seasonRaceRating`
- Card game: `collectionPower + rankedEloBonus + tournamentTier`

## Auth And State Patterns

Use SIWS or equivalent signed-message auth.

Required:

- server-generated nonce;
- short TTL;
- single-use nonce;
- signature verification;
- httpOnly secure session cookie in production;
- wallet identity from verified session only.

Never accept wallet identity from the request body for mutations.

Minimum database concepts:

- auth nonces;
- players;
- payment intents;
- payout requests if payouts exist;
- ledger.

Use advisory locks or equivalent transactions for wallet mutations, payment confirmation, payout creation, season pool changes, and burn liability updates.

## Payment Pattern

The server creates payment intents. The client signs and submits the transaction. The server verifies on-chain before granting the benefit.

Verify:

- transaction exists and succeeded;
- expected signature is present;
- SPL instruction type is correct;
- mint matches;
- amount and decimals match;
- source and destination match;
- authority matches session wallet;
- signature was not used before.

Treat null/incomplete Solana transaction data as not confirmed.

## Automatic Payout Pattern

Automatic payouts are allowed only with all controls:

- dedicated treasury wallet;
- signer secret only server-side;
- `REWARDS_PAYOUTS_ENABLED` explicit;
- `PAYOUT_KILL_SWITCH=true` blocks new payouts;
- `MAX_PAYOUT_PER_CLAIM`;
- `DAILY_PAYOUT_CAP`;
- withdraw gate;
- idempotent payout records;
- unique signature;
- statuses such as `pending`, `sent`, `confirmed`, `failed`, `blocked`;
- structured logs;
- tiny mainnet canary.

If any control is missing, payouts stay disabled.

## Health Endpoint

Every game exposes `/api/health`.

Minimum checks:

- Postgres configured and reachable;
- `RPC_URL` configured;
- Solana RPC live;
- `TOKEN_MINT` configured;
- mint account exists;
- mint owner is SPL token program;
- treasury wallet configured;
- treasury token account exists;
- `SESSION_SECRET` configured;
- payout controls configured if payouts are enabled;
- payout switch explicit.

Return 503 if launch-critical checks fail.

## Pump.fun Launch Flow

### Token Creation

Default path: create manually on Pump.fun, copy token mint and coin URL.

Advanced path: use PumpPortal API only when external IPFS metadata hosting and safe key handling are ready. Do not assume old direct Pump.fun metadata upload works.

### Treasury

Use a dedicated treasury wallet, not a personal wallet. Store private key only in server-side env. Never expose private keys through `NEXT_PUBLIC_`.

### Mainnet Canary

Before public launch:

- sign in on mainnet;
- test non-holder blocked;
- test holder allowed;
- test server ignores body wallet;
- test earn gate;
- test payment grants one benefit;
- test reused payment signature rejected;
- test spend split recorded;
- test `/api/health`;
- if payouts enabled, execute tiny payout;
- test payout idempotency, cap, daily cap, and kill switch;
- verify logs have no secrets.

## Fable Game Launch Spec

The spec includes:

- Creative Spec: name, pitch, audience, genre, visual style, core loop, progression, actions, assets, social features, seasonal events, fun.
- Economy Spec: season duration, pool, reward source, power formula, total power, gates, fees, caps, token spends, burn liability, anti-sybil assumptions.
- Solana/Pump.fun Spec: token path, mint, symbol, decimals, coin URL, RPC, treasury, token gate, payment flows.
- Auth/State Spec: auth method, cookie name, nonce TTL, database, tables, locks, player fields, ledger fields.
- Payout Spec: mode, payout enabled flag, kill switch, caps, signer storage, statuses, idempotency, canary amount.
- Launch Spec: deployment target, public URL, env, health checks, canary checks, rollback triggers, monitoring, support channel.

Use `TBD` for unknown values and mark launch blocked. Do not invent secrets, token mints, treasury keys, RPC URLs, or domains.

## Source Facts To Recheck Before Production

These were checked on 2026-07-02 and can change:

- Claude model availability and names.
- PumpPortal token creation and metadata behavior.
- PumpPortal local trading API behavior.
- PumpPortal real-time stream terms and cost.
- Solana RPC transaction response shape and commitment requirements.
- Vercel Cron limits and schedule behavior.

Use official or primary sources for current launch decisions.

