---
name: tortoise-games-studio
description: Complete Tortoise Games skillset for Claude Code and Claude Fable. Use when designing, generating, auditing, or launching Solana/Pump.fun browser games from the Tortoise Games repository; when converting the repo knowledge into instructions; when deciding which Tortoise skill to use; or when the user asks for all Tortoise folder knowledge as a skillset.
---

# Tortoise Games Studio

Use this as the master skill for the Tortoise Games repo.

## Route The Task

- Use `tortoise-fable-game-spec` when creating or completing a game spec for Claude Fable.
- Use `tortoise-solana-economy-audit` when reviewing a game design, codebase, economy, auth, payment, payout, or launch safety.
- Use `tortoise-pumpfun-launch` when preparing Pump.fun token creation, treasury setup, deploy, health, mainnet canary, or public launch.
- Use this master skill when the user asks for broad guidance, repo onboarding, skillset import, or a full Tortoise Games workflow.

## Prime Directive

Maximize game creativity. Minimize token, wallet, payment, payout, and launch risk.

Claude Fable may invent any genre, world, UI, narrative, item system, loop, or social mechanic. The implementation must still obey finite-pool rewards, server authority, Solana verification, payout safety, and launch readiness.

## Required Knowledge

Read `references/knowledge-base.md` when the task needs detailed Tortoise rules, launch flow, source map, or current repo truth.

## Non-Negotiable Rules

- Real token rewards debit a finite seasonal pool.
- Every token spend uses burn or burn-liability, recycled pool funding, and treasury accounting.
- Server calculates wallet identity, power, rewards, inventory, progress, purchases, and payout eligibility.
- Client never decides token balance, reward amount, payment success, payout success, or wallet identity for mutations.
- Login uses SIWS or signed-message auth.
- Payments use server-created intents and on-chain Solana verification.
- Reused transaction signatures are rejected.
- Automatic payouts require caps, idempotency, logs, signer isolation, and kill switch.
- `PAYOUT_KILL_SWITCH=true` means new payouts are blocked.
- Public launch requires `/api/health` ready and mainnet canary complete.
- Do not invent token mints, secrets, treasury keys, RPC URLs, or deployed domains.

## Repo Truth

Implemented shared modules:

- `shared/lib/economy.ts`
- `shared/lib/solana-lite.ts`
- `shared/lib/config.ts`

Required before production unless generated later:

- auth/session module;
- durable DB and locks;
- payment intents and on-chain verification;
- token gate;
- payout module;
- reusable app templates.

