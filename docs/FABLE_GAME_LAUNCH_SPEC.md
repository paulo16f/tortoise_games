# Fable Game Launch Spec

Claude Fable must complete this spec before generating or launching a game. Use `TBD` only while designing. A game with `TBD` in launch-critical fields is blocked from public launch.

## 1. Creative Spec

```yaml
game_name:
slug:
one_sentence_pitch:
target_audience:
genre_or_hybrid:
visual_style:
core_loop:
session_length:
progression_system:
main_actions:
items_or_assets:
social_features:
seasonal_events:
what_makes_it_fun:
```

Rules:

- Any genre is allowed.
- Examples from existing docs are inspiration only.
- Every main action must later map to server-side validation.

## 2. Economy Spec

```yaml
season_duration:
season_pool_tokens:
reward_source:
power_formula:
total_power_definition:
earn_gate:
withdraw_gate:
withdraw_fee_percent:
max_payout_per_claim:
daily_payout_cap:
token_spends:
  - name:
    token_cost:
    server_validated_benefit:
    split: burn_40_recycle_40_treasury_20
burn_liability_policy:
anti_sybil_assumptions:
```

Rules:

- `reward_source` must be a finite season pool.
- `power_formula` must be computable server-side.
- Every spend must use the split.
- Payout caps must be explicit.

## 3. Solana And Pump.fun Spec

```yaml
token_creation_path: manual_pump_fun | pumpportal_api
token_mint:
token_symbol:
token_decimals: 6
pump_fun_coin_url:
rpc_provider:
treasury_wallet:
treasury_token_account:
token_gate_amount:
payment_flows:
  - name:
    mint:
    amount_rule:
    destination:
    benefit:
    verification_fields:
```

Rules:

- `token_mint` must be a real SPL mint before production.
- Token gate must be checked server-side.
- Payment verification must inspect the on-chain transaction.

## 4. Auth And State Spec

```yaml
auth_method: signed_message
session_cookie_name:
nonce_ttl_seconds:
database:
required_tables:
lock_strategy:
player_state_fields:
ledger_fields:
client_authoritative_fields: none
```

Rules:

- Wallet comes from verified session only.
- Client-authoritative game economy fields are not allowed.
- Every mutation needs a lock or equivalent transactional protection.

## 5. Payout Spec

```yaml
payout_mode: disabled | manual | automatic
rewards_payouts_enabled:
payout_kill_switch: true_blocks_new_payouts
max_payout_per_claim:
daily_payout_cap:
signer_storage:
payout_statuses:
idempotency_key:
canary_payout_amount:
```

Rules:

- Automatic payouts require caps, kill switch, logs, and idempotency.
- `payout_kill_switch: true` means new payouts are blocked.
- If any control is missing, set `payout_mode: disabled`.
- The first mainnet payout must be a tiny canary.

## 6. Launch Spec

```yaml
deployment_target:
public_url:
required_env:
health_checks:
mainnet_canary_checks:
rollback_triggers:
monitoring_plan:
support_channel:
```

Launch is blocked unless:

- `/api/health` is ready;
- holder and non-holder tests pass;
- payment replay rejection passes;
- payout canary passes if payouts are enabled;
- secrets are not exposed;
- marketing copy has no financial promises.
