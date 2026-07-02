---
name: tortoise-solana-economy-audit
description: Audit Tortoise Games designs, specs, or code for Solana/Pump.fun economy safety. Use when reviewing token rewards, finite pools, power formulas, token spends, SIWS/session auth, payment intents, on-chain verification, payout automation, health checks, or launch blockers before code generation or production release.
---

# Tortoise Solana Economy Audit

Use this skill as a guardrail review. Do not redesign the game unless a rule is violated. Preserve creative mechanics and point only to safety, accounting, or launch-readiness issues.

## Audit Order

1. Check reward source: all real token rewards must debit a finite seasonal pool.
2. Check spend accounting: every token spend must split into burn or burn-liability, recycled pool funding, and treasury.
3. Check authority boundaries: server calculates wallet identity, power, rewards, progress, purchases, and payout eligibility.
4. Check payment flow: server-created intent, Solana transaction verification, replay rejection.
5. Check payout flow: caps, idempotency, logs, signer isolation, and kill switch.
6. Check launch readiness: `/api/health`, holder/non-holder tests, mainnet canary, and no financial promises.

## Severity

- `Blocker`: can lose funds, double-pay, fake rewards, trust client state, or launch without required controls.
- `High`: can break accounting, block legitimate users, or create major exploit paths.
- `Medium`: weak operational safety, incomplete monitoring, unclear launch procedure.
- `Low`: wording, completeness, or maintainability issues.

## Required References

Read these repo docs as needed:

- `../tortoise-games-studio/references/knowledge-base.md` for the complete Tortoise Games knowledge base.
- `../../../docs/ECONOMY_LAWS.md` for tokenomics invariants.
- `../../../docs/CODEX_PATTERNS.md` for auth, DB, locks, payments, payouts, health, and deployment.
- `../../../docs/PUMPFUN_LAUNCH.md` for launch and canary checks.
- `../../../shared/lib/economy.ts` when checking current economy engine behavior.
- `../../../shared/lib/solana-lite.ts` when checking Solana helper assumptions.

## Output Format

Start with findings, ordered by severity. Include concrete file/section references when auditing repo files. If no blockers are found, say so clearly and list remaining launch risks.

Do not imply missing modules are implemented. The current implemented shared modules are `economy.ts`, `solana-lite.ts`, and `config.ts`; auth, DB, payment, token gate, API helpers, and templates remain required before production unless generated later.
