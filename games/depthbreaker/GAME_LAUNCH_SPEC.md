# Depthbreaker — Game Launch Spec

> **LAUNCH BLOCKED.** The Solana/Pump.fun layer is intentionally deferred (Phase 2). Sections 3 and 5 contain `TBD` in launch-critical fields, and required shared modules (`shared/lib/auth.ts`, `db.ts`, `payment.ts`, `token-gate.ts`, `api.ts`) are not yet implemented. Do not share a public link. See `docs/DEPTHBREAKER_TECHNICAL_DESIGN.md` Appendix B for the full blocker list.

Filled from the template at `docs/FABLE_GAME_LAUNCH_SPEC.md`.

## 1. Creative Spec

```yaml
game_name: Depthbreaker
slug: depthbreaker
one_sentence_pitch: >
  A browser 3D multiplayer roguelike where you meet other players in a shared
  hub, dive into seeded co-op dungeon runs that reset on death, and spend
  persistent meta-currency on a permanent upgrade tree — Hades meets MMO-lite.
target_audience: >
  Roguelike/roguelite players (Hades, Isaac, Dead Cells) and lapsed MMO players
  who want short, drop-in browser sessions with visible other players.
genre_or_hybrid: 3D multiplayer action roguelike / MMO-lite hybrid
visual_style: >
  Stylized low-poly 3D (purchased modular asset packs), strong silhouette
  readability, URP Forward on WebGL2.
core_loop: >
  Hub (social, spend meta-currency) -> start seeded dungeon run -> fight
  target-based combat, level 1-30 within the run, loot rarity-tiered items ->
  die or clear -> meta-currency awarded even on death -> back to hub -> upgrade
  permanent tree -> next run is stronger.
session_length: 15-30 minutes per run; hub visits 2-5 minutes.
progression_system: >
  Two axes. Run axis (resets on death): run level 1-30, run items, temporary
  buffs, dungeon depth. Account axis (persists): meta-currency, permanent
  upgrade tree ranks, class/skill/cosmetic unlocks, run history.
main_actions: >
  move (WASD, server-reconciled prediction), click-to-target, auto-attack,
  use skill 1/2 (validated cooldown/resource/range), pick up loot, enter run,
  spend meta-currency, buy upgrade rank.
items_or_assets: >
  Run-scoped gear with server-rolled stats in 5 rarity tiers
  (common/uncommon/rare/epic/legendary); account-scoped unlocks (classes,
  skills, cosmetics).
social_features: >
  Shared persistent hub zone with visible players (Phase 0); party co-op runs,
  leaderboards (Phase 1+).
seasonal_events: >
  Seasonal reward pool resets per season (Phase 2, wired to the Tortoise
  finite-pool economy); seasonal leaderboard and cosmetic drops planned.
what_makes_it_fun: >
  Every death still pays (meta-currency), every run is a fresh seeded build,
  and other real players are visible in the hub and zones — permanence where
  it motivates, resets where they keep runs tense.
```

## 2. Economy Spec

Phase 0 has **no real token**. `meta_currency` is an off-chain integer earned per run and spent on the upgrade tree. This section defines how it maps onto the Tortoise economy when the Solana layer lands (Phase 2).

```yaml
season_duration: 30d (planned; Phase 2)
season_pool_tokens: TBD
reward_source: finite_season_pool (via shared/lib/economy.ts createEconomyEngine; Phase 2)
power_formula: >
  power = best_depth_reached * 100 + total_boss_kills * 250
  + upgrade_tree_ranks * 10   (server-computed only; Phase 0 already stores
  every input server-side in runs/account_upgrades tables)
total_power_definition: sum of power across all accounts active this season
earn_gate: token_gate_amount held (TBD) AND account age > 24h
withdraw_gate: token_gate_amount held (TBD) AND email/wallet-verified account
withdraw_fee_percent: 5
max_payout_per_claim: TBD
daily_payout_cap: TBD
token_spends:
  - name: run_blessing (start next run with +1 upgrade rank active)
    token_cost: TBD
    server_validated_benefit: server flags next run row with blessing_id
    split: burn_40_recycle_40_treasury_20
  - name: cosmetic_unlock
    token_cost: TBD
    server_validated_benefit: server inserts account_unlocks row
    split: burn_40_recycle_40_treasury_20
burn_liability_policy: >
  If immediate on-chain burn is unavailable, record burn liability in ledger
  and settle per ECONOMY_LAWS.md Law 2. (Phase 2)
anti_sybil_assumptions: >
  Meta-currency (off-chain) has no real value in Phase 0. In Phase 2, real
  rewards require token gate + account age; guest accounts can never
  withdraw.
```

## 3. Solana And Pump.fun Spec

Deferred to Phase 2. All values `TBD` — **this alone blocks public launch.** Integration seams are designed and documented in `docs/DEPTHBREAKER_TECHNICAL_DESIGN.md` Appendix A.

```yaml
token_creation_path: TBD (manual_pump_fun | pumpportal_api)
token_mint: TBD
token_symbol: TBD
token_decimals: 6
pump_fun_coin_url: TBD
rpc_provider: TBD
treasury_wallet: TBD
treasury_token_account: TBD
token_gate_amount: TBD
payment_flows:
  - name: TBD
    mint: TBD
    amount_rule: TBD
    destination: TBD
    benefit: TBD
    verification_fields: TBD
```

## 4. Auth And State Spec

Phase 0 uses guest/email JWT auth (no wallet). SIWS replaces/augments it in Phase 2 with the same session-cookie shape, so action handlers do not change.

```yaml
auth_method: jwt_guest_email (Phase 0) -> signed_message SIWS (Phase 2)
session_cookie_name: db_refresh (HttpOnly, Secure, SameSite=Lax; access JWT in memory only)
nonce_ttl_seconds: 300 (Phase 2 SIWS nonces; Phase 0 has none)
database: PostgreSQL 16
required_tables: >
  accounts, refresh_tokens, characters, meta_wallets, meta_upgrades,
  account_upgrades, account_unlocks, runs, inventory_items, schema_migrations
  (Phase 2 adds auth_nonces, payment_intents, payout_requests, ledger per
  CODEX_PATTERNS.md)
lock_strategy: >
  Row-level SELECT ... FOR UPDATE inside transactions for wallet/currency
  mutations; pg advisory locks reserved for cross-row settlement in Phase 2.
player_state_fields: >
  account: meta_currency, upgrade ranks, unlocks. character: name, class.
  run: seed, status, depth_reached, xp_earned, currency_earned, loot.
ledger_fields: Phase 2 (token amounts, split breakdown, tx signatures)
client_authoritative_fields: none
```

## 5. Payout Spec

```yaml
payout_mode: disabled
rewards_payouts_enabled: false
payout_kill_switch: true_blocks_new_payouts (set true)
max_payout_per_claim: TBD
daily_payout_cap: TBD
signer_storage: TBD (server-side env only, never NEXT_PUBLIC_/client)
payout_statuses: pending | sent | confirmed | failed | blocked (schema planned Phase 2)
idempotency_key: payout_request_id (uuid, unique)
canary_payout_amount: TBD
```

## 6. Launch Spec

```yaml
deployment_target: >
  Always-on long-running workers (NOT Vercel serverless): headless Unity Linux
  zone servers + Node backend behind nginx TLS. Dev/persistent on a VPS
  (e.g. Hetzner); instanced runs on container orchestration (e.g. Edgegap)
  at scale.
public_url: TBD
required_env: >
  DATABASE_URL, SESSION_SECRET, ZONE_SHARED_SECRET, ZONE_WS_URL,
  CORS_ORIGIN, NODE_ENV. Phase 2 adds: SOLANA_RPC_URL, TOKEN_MINT,
  TOKEN_SYMBOL, TOKEN_DECIMALS, TOKEN_GATE_AMOUNT, TREASURY_WALLET,
  TREASURY_PRIVATE_KEY, REWARDS_PAYOUTS_ENABLED=false, PAYOUT_KILL_SWITCH=true,
  MAX_PAYOUT_PER_CLAIM, DAILY_PAYOUT_CAP.
health_checks: >
  GET /api/health: DB reachable + migrated, SESSION_SECRET and
  ZONE_SHARED_SECRET set and non-default, NODE_ENV sane. Fails closed with
  503 (ProductionReadinessError). Phase 2 adds RPC/mint/treasury checks per
  CODEX_PATTERNS.md pattern 6.
mainnet_canary_checks: TBD (Phase 2; per PUMPFUN_LAUNCH.md Phase 7)
rollback_triggers: >
  /api/health non-200; refresh-token reuse spike; implausible run-finish
  reports (422 rate); zone server crash loop.
monitoring_plan: >
  Backend structured logs (Fastify), pg row counts on runs/meta_wallets,
  nginx access logs. Phase 2 adds payout/ledger daily review.
support_channel: TBD
```
