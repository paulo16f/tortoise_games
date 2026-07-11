# Depthbreaker Phase 2 — Token Economy Design

> **Status: DESIGN — NOT IMPLEMENTED. LAUNCH REMAINS BLOCKED.**
> Every production value in this document is `TBD` on purpose (mint, treasury,
> RPC, gate amounts). Filling them in happens at launch prep, never before.
> This document replaces the emission-pool-centric Phase 2 sketch in
> `GAME_LAUNCH_SPEC.md` §2/§3/§5 as the normative token design.

This is a self-contained reference. It assumes no memory of prior sessions:
read it cold, and you know what Phase 2 is, why it's shaped this way, and what
to build in what order.

---

## 1. Executive summary

Phase 2 adopts the economy architecture proven live by **Kintara**
(kintara.gg — a Solana isometric MMO, ~20k monthly players, ~$54k/day P2P
volume), adapted to Depthbreaker and the Pump.fun token path:

- **The game mints only GOLD, never tokens.** Gold faucets are gameplay
  (daily quests, spinner, selling loot/ore to the NPC market). All of that
  already exists or is planned off-chain.
- **Players convert gold → token by selling gold to OTHER PLAYERS** on a
  P2P marketplace. The buyer pays on-chain from their own wallet; the seller
  receives 95%; 5% goes to the game treasury. **The game itself never sends
  tokens to players.**
- **The token enters the game at exactly three points**, all narrow, all
  server-verified:
  1. a **token gate** (hold ≥ `TOKEN_GATE_AMOUNT` to play),
  2. **premium spends** (USD-quoted, e.g. paid spinner spins) split
     **50% burn / 50% treasury**,
  3. the **5% marketplace fee** on P2P gold sales.

Why this is the right shape for us:

- It **deletes the riskiest subsystem**. The old sketch required a payout
  signer, an emission formula, per-claim/daily payout caps, and payout
  automation with a kill switch — the #1 source of catastrophic bugs in
  play-to-earn games. Under this model the game holds no player-payable token
  balance and signs no outbound reward transactions. "Payout risk" shrinks to
  "verify an inbound P2P payment correctly."
- It is still **play-to-earn in practice**: time spent gathering/questing
  produces gold; gold has a real price because other players want it (to buy
  gear, skins, and convenience without grinding).
- It matches our guardrails (§4) with one explicit, documented amendment.

---

## 2. Currency architecture

Two currencies, strictly separated:

| | **Gold** (off-chain) | **$TOKEN** (Pump.fun SPL, on-chain) |
|---|---|---|
| Lives in | `meta_wallets.currency` (Postgres) | Player wallets on Solana |
| Mutated by | Backend only, via `/internal/wallet/*` conditional SQL (exists today) | Player-signed transactions only |
| Game can create it? | Yes (capped faucets) | **Never** |
| Game can hold it? | n/a | Treasury receives fees/spends; treasury never sells to players |
| Player acquires by | Playing | Buying on Pump.fun/DEX, or selling gold P2P |

### 2.1 Gold faucets (game-minted, all server-side, all capped)

| Faucet | Status | Cap mechanism |
|---|---|---|
| Run rewards (kill currency, credited at run finish) | **Live** | `maxCurrencyForDepth(depth)` plausibility cap (`packages/sim/src/plausibility.ts`) |
| Selling ore/loot to the NPC market | **Live** | Server-priced `sellValue`; credit route capped 2000/call |
| Daily quests | Planned (this phase) | Fixed rewards; ≤ 3 quests/day; per-day gold total documented in the quest catalog |
| Spinner wheel — free daily spin | Planned | 1/24h, prize table server-rolled, ~1/20 spins pay gold |
| Events / merchants | Future | Per-event budgets |

### 2.2 Gold sinks (all live or in this phase)

| Sink | Status |
|---|---|
| NPC market purchases (gear, potions) | **Live** |
| Cosmetic skins (recolors + model swaps) | Planned (this phase) |
| Building costs (Kintara: firepit/shack) | Future candidate |
| P2P marketplace: gold leaves the seller when a listing sells | Phase 2 |

### 2.3 $TOKEN flows (Phase 2 only)

Faucets from the game's perspective: **none.** Sinks/uses:

| Flow | Direction | Split |
|---|---|---|
| Token gate | none (balance check only, no transfer) | n/a |
| Paid spinner spin (`SPIN_PRICE_USD` worth of $TOKEN) | player → burn + treasury | 50% burn / 50% treasury |
| Premium conveniences (run blessing, exclusive cosmetics) | player → burn + treasury | 50% burn / 50% treasury |
| P2P gold purchase | buyer player → seller player + treasury | 95% seller / 5% treasury |

---

## 3. The three token touchpoints, in detail

### 3.1 Token gate (entry requirement)

- Wallet login via **SIWS** (sign-in message; nonce TTL 300s per the launch
  spec). Signing proves wallet ownership. **No transfer happens at login**
  (AGENTS.md guardrail #5).
- On character create / play, the backend checks the wallet's $TOKEN balance
  via RPC: `balance ≥ TOKEN_GATE_AMOUNT` (Kintara uses 1,000 KINS; ours is
  `TBD`). Cache the check briefly (60–300s) to avoid RPC hammering; re-check
  at session refresh.
- The gate is also the **primary sybil brake**: every farming account must
  hold the gate amount, making bot farms capital-expensive (this is exactly
  how Kintara controls gold-farm supply).
- Guest/email accounts (Phase 0 auth) remain for free-trial play but are
  **hard-excluded from the P2P marketplace** (they have no wallet).

### 3.2 Premium spends (USD-quoted, burn + treasury)

- Prices are quoted in **USD, converted at the live $TOKEN price at quote
  time** (Kintara's answer to token volatility — a spin is always "$5", not
  "N tokens"). Price feed: `TBD` (Pump.fun/DEX quote via RPC or indexer), with
  a staleness bound; if the feed is stale, premium spends are disabled
  (fail closed).
- Flow (server-created **payment intent**, per `docs/CODEX_PATTERNS.md`):
  1. Client requests a spend → backend creates `payment_intents` row
     (id, account, kind, usd_price, token_amount_quoted, expires_at).
  2. Client wallet sends ONE transaction: `token_amount` split to the burn
     address/mechanism and the treasury token account (or full amount to
     treasury with a burn-liability ledger entry — see below).
  3. Client submits the tx signature; the backend **verifies on-chain**
     (`shared/lib/solana-lite.ts`): correct mint, amounts, destinations,
     recency; then grants the benefit server-side.
  4. **Idempotency**: tx signatures are unique-indexed; a replayed signature
     is rejected (guardrail #8).
- **Split: 50% burn / 50% treasury.** If immediate on-chain burn isn't
  implemented at launch, the burn half is recorded as a **burn liability** in
  the ledger and executed in batches — never described as burned until the
  burn tx exists (Law 2's honesty requirement, kept).
- Launch premium catalog (all `TBD` pricing): paid spinner spin
  (`SPIN_PRICE_USD ≈ $5`), run blessing (start next run with +1 upgrade rank
  active — server flags the run row), exclusive cosmetic tier.

### 3.3 P2P gold-for-$TOKEN marketplace (the "earn" path)

- Sellers list **gold** in exchange for $TOKEN at a USD-referenced price.
  Buyers browse listings and pay **on-chain from their own wallet**; the
  payment transaction splits automatically: **95% → seller's wallet,
  5% → treasury** (single transaction with two transfers, verified
  server-side before gold moves).
- **Escrow rule**: listed gold is debited from the seller's `meta_wallets`
  balance **at listing time** (escrowed in the listing row). Cancel →
  refund. Sale → gold credited to the buyer. This is the two-table-atomicity
  lesson from world-of-claudecraft's market (`saveCharacterAndMarketState`):
  wallet mutation and listing mutation always share one DB transaction so a
  torn write can never duplicate or vaporize gold.
- Settlement order (Law 3's handler order applies):
  verify session → verify on-chain payment (mint/amounts/destinations/
  signature-unique) → lock listing row → credit buyer gold + mark sold →
  ledger entry. The seller's tokens arrived peer-to-peer; the game never
  touched them.
- **Item listings stay gold-only** at launch (like Kintara): items ↔ gold
  P2P, gold ↔ token P2P. Direct item-for-token adds tax/complexity for no
  benefit.
- Prerequisite already planned: the **persistent stash** (bank) so tradable
  goods survive runs; the P2P item market builds on it.

---

## 4. Guardrail compliance (ECONOMY_LAWS.md, law by law)

| Law | Verdict | How |
|---|---|---|
| **1 — Real rewards from a finite pool** | Satisfied structurally | The game pays **zero** token rewards, so there is no emission to cap. "Real reward earnings" happen only as P2P transfers between players. If game-paid token events are EVER added (tournaments etc.), they must be funded from a seeded, finite event pool — that clause stays. |
| **2 — Every spend uses a split** | **Amended (explicit)** | Split is **50% burn / 50% treasury** instead of 40/40/20. Rationale: the 40% "recycle into the seasonal pool" leg exists to fund game-paid rewards; this design has none, so recycling would accumulate a pool with no outlet. The law's substantive requirements are kept in full: every spend accounted through one shared split function, burn executed or ledgered as liability, treasury tracked. This amendment is per-title and recorded here + in the launch spec. |
| **3 — Server is the clock** | Satisfied | Already true for gold (conditional SQL, zone-server trust boundary). Token flows add: server-created intents, server-side on-chain verification, row locks, ledger writes — same handler order. `client_authoritative_fields: none` stands. |
| **4 — Earn/withdraw gates** | Satisfied, remapped | Token gate = hold `TOKEN_GATE_AMOUNT` (also sybil brake). Earn gate = minimum account progress (e.g. level ≥ `TBD`, account age > 24h) before **listing gold**. Withdraw gate = the P2P sale itself (requires a wallet buyer). Per-claim cap = `MAX_GOLD_PER_LISTING`. Daily cap = `MAX_GOLD_LISTED_PER_DAY` per account. **Kill switch = `MARKET_FREEZE=true`** halts new listings/sales instantly (replaces the payout kill switch). |
| **5 — Power is one server number** | Unchanged | `power = best_depth*100 + boss_kills*250 + upgrade_ranks*10` stays for leaderboards/events; it no longer gates token emission (there is none), which removes the whale/sybil pressure on the formula. |

AGENTS.md non-negotiable #1 ("real reward earnings come from a finite
seasonal pool, never uncapped minting") is satisfied vacuously and honestly:
the game mints no token rewards at all; gold minting is capped per §2.1.

---

## 5. Implementation architecture

### 5.1 New DB tables (extends launch spec §4)

- `auth_nonces` — SIWS nonces (nonce, wallet, expires_at, used).
- `payment_intents` — id, account_id, kind, usd_price, token_amount,
  quote_at, expires_at, status, tx_signature (UNIQUE, nullable until paid).
- `market_listings` — id, seller_account, gold_amount (escrowed), usd_price,
  status (open/sold/cancelled), buyer_account, tx_signature (UNIQUE),
  created/sold timestamps.
- `token_ledger` — every token-relevant event: kind (spend/fee/burn_liability/
  burn_executed), amounts, split breakdown, tx signature, intent/listing id.

### 5.2 Flows (text sequence)

**SIWS login**: client asks for nonce → signs message → backend verifies
signature + nonce freshness → issues the SAME session shape as today
(`db_refresh` cookie + 15-min access JWT) with `wallet` on the account row.
Phase 0 guest/email auth continues to work; accounts can link a wallet later
(mirrors the guest→email upgrade-in-place pattern already live).

**Paid spin**: intent → wallet signs → submit signature → verify (mint,
amount vs quote, destinations, uniqueness, recency) → ledger (burn liability
+ treasury) → roll the wheel server-side → prize granted via existing
capped wallet/bag plumbing.

**Gold listing sale**: buyer fetches quote → wallet sends 95/5 split tx →
submit signature → verify → single DB tx: mark listing sold + credit buyer
gold + ledger the 5% fee → seller already has tokens (peer-to-peer).

### 5.3 What exists today that this builds on

- Wallet: `meta_wallets` + `/internal/wallet/{balance,debit,credit}` with
  conditional SQL (live, tested).
- Trust boundary: zone server ↔ backend shared-secret `/internal` API (live).
- Plausibility caps (live). Idempotent run settlement (live).
- `shared/lib/solana-lite.ts` + `shared/lib/economy.ts` (repo-level, built).
- Missing shared modules flagged by AGENTS.md (`auth.ts`, `payment.ts`,
  `token-gate.ts`, `db.ts`, `api.ts`) get built or superseded in this phase.

### 5.4 Anti-abuse

- Token gate = capital cost per account (primary sybil brake, per Kintara).
- Gold faucets capped per §2.1; listing caps per Law 4 row above.
- USD quotes bounded by feed staleness; fail closed.
- Rate limits on listing creation and intent creation.
- `MARKET_FREEZE` + premium-spend disable flags = instant kill switches.
- Ledger + daily treasury/burn reconciliation review (ops runbook TBD).

---

## 6. Launch checklist (Phase 2 gate)

Env (extends launch spec §6): `SOLANA_RPC_URL`, `TOKEN_MINT`, `TOKEN_SYMBOL`,
`TOKEN_DECIMALS`, `TOKEN_GATE_AMOUNT`, `TREASURY_WALLET`,
`TREASURY_TOKEN_ACCOUNT`, `PRICE_FEED_SOURCE`, `SPIN_PRICE_USD`,
`MARKET_FEE_BPS=500`, `MAX_GOLD_PER_LISTING`, `MAX_GOLD_LISTED_PER_DAY`,
`MARKET_FREEZE=true` (default ON until canary), `PREMIUM_SPENDS_ENABLED=false`.
Note the OLD payout vars (`REWARDS_PAYOUTS_ENABLED`, `MAX_PAYOUT_PER_CLAIM`,
`DAILY_PAYOUT_CAP`, `TREASURY_PRIVATE_KEY` for payouts) are **retired** —
there is no payout signer in this design.

Sequence:
1. Fill every `TBD` (token created per `docs/PUMPFUN_LAUNCH.md`).
2. `/api/health` extended: RPC reachable, mint matches, treasury account
   exists, price feed fresh — fail closed 503.
3. **Mainnet canary** (manual, required by AGENTS.md #11): one real paid spin
   (verify burn-liability + treasury ledger), one real gold listing bought by
   a second wallet (verify 95/5 + gold credit), with `MARKET_FREEZE` lifted
   for the canary accounts only.
4. Unfreeze gradually; watch ledger reconciliation daily.
5. Marketing copy: no financial promises (AGENTS.md #12) — "trade with other
   players", never "earn $X".

## 7. Migration path from today

| Today (live) | Phase 2 |
|---|---|
| Gold wallet + NPC market | Unchanged; NPC market remains the gold price floor |
| Guest/email auth | Stays for trial; SIWS added; wallet-linked accounts unlock the P2P market |
| Persistent stash (this phase) | Becomes the tradable-goods anchor for P2P item listings |
| Daily quests + free spinner (this phase) | Same systems; paid spins switch on as the first premium spend |
| Cosmetics gold shop (this phase) | Gains an exclusive premium tier (token-priced) |
| Payout spec (§5 of launch spec) | Retired; superseded by this document |

---

*Reference: Kintara docs (kintara.gg/#docs), captured 2026-07-10 — realm/gathering/marketplace/spinner/$KINS mechanics as the working example of this architecture in production.*
