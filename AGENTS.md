# Tortoise Games Studio Agent Rules

`CLAUDE.md` points here. This file is the entry point for Claude Code, Claude Fable, and any subagent that designs or reviews a Tortoise Games title.

## Prime Directive

Maximize game creativity. Minimize financial, token, wallet, and launch risk.

Fable may invent any game concept. It must prove that the concept can be implemented with server-authoritative state and safe Solana/Pump.fun integration before production code is accepted.

## Creative Freedom

The model is free to design:

- any genre or hybrid genre;
- any theme, story, world, character system, item system, quest system, battle system, idle loop, social loop, PvP loop, leaderboard, event, or seasonal content;
- any UI/UX style appropriate for the game;
- any progression model, as long as the server can validate it;
- any token spend, as long as it uses the required split and on-chain verification.

Examples such as idle, battle, clicker, farming, racing, RPG, MMO, dungeon crawler, collection game, strategy game, or card game are starting points only. They are not limits.

## Non-Negotiable Guardrails

Every game must satisfy all of these:

1. Real reward earnings come from a finite seasonal pool, never uncapped minting.
2. Every token spend is split into burn, recycled pool funding, and treasury accounting.
3. The server calculates power, rewards, inventory, progress, purchases, and payout eligibility.
4. The client never decides wallet identity, reward amount, token balance, payment amount, payment success, or payout success.
5. Login uses SIWS or an equivalent signed-message flow. Login must not require a token transfer.
6. Action handlers read wallet identity from a verified session cookie, never from the request body.
7. In-game token payments use server-created payment intents and on-chain Solana transaction verification.
8. Reused transaction signatures are rejected through idempotency and database uniqueness.
9. Payout automation must include caps, idempotency, logs, and a kill switch.
10. `/api/health` must return launch-ready status before a public link is shared.
11. Public launch requires a manual mainnet canary.
12. Marketing copy must avoid financial promises.

## Required Game Launch Spec

Before writing game code, fill out `docs/FABLE_GAME_LAUNCH_SPEC.md`.

The spec must include:

- creative spec: concept, audience, loop, progression, UI, assets;
- economy spec: power formula, spend list, gates, season pool, season duration;
- Solana spec: token mint, treasury, RPC, token gate, payment flows;
- payout spec: payout mode, signer rules, caps, kill switch;
- launch spec: env vars, health checks, canary checks, rollback triggers.

If any field is unknown, use `TBD` and mark launch blocked. Do not invent production values for treasury keys, RPC URLs, secrets, token mints, or deployed domains.

## Repo Truth

Implemented shared modules:

- `shared/lib/economy.ts`
- `shared/lib/solana-lite.ts`
- `shared/lib/config.ts`

Not yet implemented but required before production:

- `shared/lib/auth.ts`
- `shared/lib/db.ts`
- `shared/lib/payment.ts`
- `shared/lib/token-gate.ts`
- `shared/lib/api.ts`
- reusable game templates

When generating a game, do not claim missing modules are wired. Either generate them as part of the work or document them as launch blockers.

## Production Defaults

- `REWARDS_PAYOUTS_ENABLED=false` until payout signer, caps, idempotency, and canary are proven.
- If automatic payouts are enabled later, require `MAX_PAYOUT_PER_CLAIM`, `DAILY_PAYOUT_CAP`, `PAYOUT_KILL_SWITCH`, and transaction logging.
- `PAYOUT_KILL_SWITCH=true` means new payouts are blocked.
- Missing production env values must fail closed with 503 or a startup error.
- Vercel games settle rewards opportunistically on player traffic unless the deployment plan supports reliable background jobs.
- WebSocket or true always-on games need a deployment target with long-running workers.

## Required References

Read these before any game launch task:

- `docs/FABLE_GAME_LAUNCH_SPEC.md`
- `docs/ECONOMY_LAWS.md`
- `docs/CODEX_PATTERNS.md`
- `docs/PUMPFUN_LAUNCH.md`
