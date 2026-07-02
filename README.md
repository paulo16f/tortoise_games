# Tortoise Games

Tortoise Games is a documentation-first workspace for creating Solana browser games that integrate with Pump.fun tokens. Its job is to give Claude Fable enough freedom to invent real games while enforcing the production rules that keep token, wallet, payment, payout, and launch flows server-authoritative.

## Current State

Implemented today:

| Path | Status |
|---|---|
| `shared/lib/economy.ts` | Implemented seasonal pool engine: `settle()`, `burnSplit()`, `poolStats()` |
| `shared/lib/solana-lite.ts` | Implemented minimal Solana RPC helpers and SPL token program constant |
| `shared/lib/config.ts` | Implemented env helpers and `ProductionReadinessError` |
| `docs/` | Production rules, economy rules, and Pump.fun launch manual |
| `.claude/agents/web3-game-economy.md` | Claude/Fable guardrails for game economy and Solana review |

Required before a production launch:

| Missing item | Why it matters |
|---|---|
| `shared/lib/auth.ts` | SIWS/sign-message login, nonce storage, session cookie verification |
| `shared/lib/db.ts` | Postgres access, migrations, advisory locks, idempotency constraints |
| `shared/lib/payment.ts` | Server-created payment intents and Solana transaction verification |
| `shared/lib/token-gate.ts` | SPL holder checks for access and earning gates |
| `shared/lib/api.ts` | Standard fail-closed responses and error handling |
| `templates/` | Reusable game scaffolds for Next.js/Vercel and Express/WebSocket deployments |

Do not tell Claude Fable that missing modules are already implemented. Tell it to design against these interfaces and either generate them or block launch until they exist.

## Fable Workflow

1. Fill out `docs/FABLE_GAME_LAUNCH_SPEC.md`.
2. Ask Claude Fable to create the game freely inside the creative spec.
3. Require Fable to map every creative mechanic to server-side state and economy rules.
4. Run the `web3-game-economy` guardrail agent before writing production code.
5. Block public launch until `docs/PUMPFUN_LAUNCH.md` passes.

## Easy Skill Import

For Claude Code, no manual import is needed after cloning the repo. Claude Code auto-discovers project skills from:

```txt
.claude/skills/
```

For Claude.ai, import one skill package:

```txt
skill-packages/tortoise-games-studio-claudeai.zip
```

That ZIP contains the master `tortoise-games-studio` skill and the full Tortoise Games knowledge base using Claude.ai-safe paths only. The smaller skills in `.claude/skills/` are useful for Claude Code routing, but Claude.ai users do not need to upload them one by one.

## Creative Freedom

Fable is allowed to create any genre, theme, art direction, story, UX, mechanic, item system, quest system, social system, or retention loop.

Fable is not allowed to violate:

- finite seasonal reward pools;
- server-side reward settlement;
- server-side power calculation;
- spend split accounting;
- session-based wallet auth;
- on-chain payment verification;
- payout caps and kill switch;
- `/api/health` launch gate;
- mainnet canary before public release.

## Source References

These references were checked on 2026-07-02 and should be rechecked before production launch:

- Claude Fable model details: https://platform.claude.com/docs/en/about-claude/models/overview
- PumpPortal token creation: https://pumpportal.fun/creation/
- PumpPortal local trading API: https://pumpportal.fun/local-trading-api/trading-api/
- PumpPortal real-time data: https://pumpportal.fun/data-api/real-time/
- Solana `getTransaction`: https://solana.com/docs/rpc/http/gettransaction
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
