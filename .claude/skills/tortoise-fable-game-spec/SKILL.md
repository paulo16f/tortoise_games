---
name: tortoise-fable-game-spec
description: Create or complete a Fable-ready Game Launch Spec for Tortoise Games. Use when the user wants Claude Fable to design a Solana/Pump.fun game, brainstorm a new token-gated game, convert a game idea into a launch-ready spec, or prepare inputs before generating game code without limiting creative mechanics.
---

# Tortoise Fable Game Spec

Use this skill to turn a game idea into a `docs/FABLE_GAME_LAUNCH_SPEC.md`-compatible spec.

## Workflow

1. Preserve creative freedom: allow any genre, theme, world, UX, progression, story, loop, or social mechanic.
2. Map every creative mechanic to server-authoritative state.
3. Fill all launch-critical fields: token, treasury, RPC, payout mode, power formula, gates, spends, health checks, and canary.
4. Use `TBD` only when the user has not provided a production value. Mark every `TBD` launch-critical field as a blocker.
5. Do not invent secrets, token mints, treasury keys, production domains, or deployed URLs.
6. End with either a complete spec or a blocker list.

## Required References

Read these repo docs as needed:

- `../tortoise-games-studio/references/knowledge-base.md` for the complete Tortoise Games knowledge base.
- `../../../docs/FABLE_GAME_LAUNCH_SPEC.md` for the exact spec shape.
- `../../../AGENTS.md` for creative freedom and non-negotiable guardrails.
- `../../../docs/ECONOMY_LAWS.md` when defining rewards, power, gates, and spends.
- `../../../docs/CODEX_PATTERNS.md` when defining auth, state, payment, and payout controls.

## Output Rules

- Keep the creative section expansive.
- Keep the economy and Solana sections strict.
- Treat examples like idle, RPG, farming, racing, strategy, and card games as inspiration only.
- Never force a game into a predefined template if a better mechanic fits.
- Always require a single server-side `power` value for reward share.
- Always require finite pool accounting for real rewards.
