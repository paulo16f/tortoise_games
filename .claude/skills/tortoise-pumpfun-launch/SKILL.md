---
name: tortoise-pumpfun-launch
description: Prepare or review a Tortoise Games Pump.fun/Solana launch. Use when planning token creation, PumpPortal API usage, treasury setup, env vars, Solana RPC readiness, token gates, production deploys, automatic payout canaries, health checks, public launch, post-launch operations, or GitHub-ready launch documentation.
---

# Tortoise Pump.fun Launch

Use this skill to prepare a real launch checklist or identify launch blockers for a Tortoise Games title using a Pump.fun/SPL token.

## Workflow

1. Confirm `docs/FABLE_GAME_LAUNCH_SPEC.md` is complete.
2. Choose token creation path:
   - manual Pump.fun creation for first launches;
   - PumpPortal API only when IPFS metadata hosting and key handling are ready.
3. Verify treasury setup: dedicated wallet, token account, server-only signer storage.
4. Verify server readiness: auth, DB, locks, token gate, payment intents, payout records, and health endpoint.
5. Verify payment safety: on-chain transaction inspection, exact field matching, signature replay rejection.
6. Verify automatic payout controls before enabling payouts.
7. Run mainnet canary before public launch.
8. Produce a blocker list before any public link is shared.

## Automatic Payout Rule

Automatic payouts are allowed only when all controls exist:

- `REWARDS_PAYOUTS_ENABLED` is explicit.
- `PAYOUT_KILL_SWITCH=true` blocks new payouts.
- `MAX_PAYOUT_PER_CLAIM` is configured.
- `DAILY_PAYOUT_CAP` is configured.
- payout records are idempotent.
- payout signatures are logged.
- a tiny mainnet canary payout passes.

If any control is missing, keep payouts disabled.

## Required References

Read these repo docs as needed:

- `../tortoise-games-studio/references/knowledge-base.md` for the complete Tortoise Games knowledge base.
- `../../../docs/PUMPFUN_LAUNCH.md` for the full launch manual.
- `../../../docs/FABLE_GAME_LAUNCH_SPEC.md` for required launch inputs.
- `../../../docs/CODEX_PATTERNS.md` for server, payment, payout, and health checks.
- `../../../README.md` for current repo implementation status.

## Source Policy

For current Pump.fun, PumpPortal, Vercel, Solana, or Claude model claims, recheck the official or primary source before finalizing launch guidance. Do not rely on stale assumptions for API behavior, cron limits, transaction fields, or model availability.
