# Economy v2 — Combat-First Design (normative)

> **Status: DESIGN + PARTIAL IMPLEMENTATION. LAUNCH REMAINS BLOCKED.**
> Every production Solana value (mint, treasury, RPC, gate amount, fee splits)
> is `TBD` on purpose — filled at launch prep, never before. This replaces
> `PHASE2_TOKEN_ECONOMY.md` as the normative economy design.

## 0. Identity: "your skill is your yield"

Depthbreaker's differentiator is **combat** — 4-class kits, a real skill
engine, telegraphed bosses, the coliseum ladder. The economy is built so that
combat IS the economic activity: better play → more materials per hour, higher
coliseum tiers, rarer drops. This deliberately inverts Kintara's
gathering-first shape while adopting its proven token rails.

Reference lessons this design is built on:

- **Axie**: faucets without sinks + yields that depend on player growth =
  death spiral. Every faucet here is capped + ledgered; no yield ever depends
  on new players joining ("the late-joiner fun test").
- **Albion**: combat must DESTROY value or gear saturates and crafting dies.
  Here: durability, consumables, and keys burn value every session.
- **Path of Exile**: content itself can be the consumable (maps → our Trial
  Keys).
- **Kintara** (live, ~20k MAU): USD-quoted P2P with token settlement, 95/5
  split, scarce gold, and — critically — pump.fun creator fees funding the
  treasury's gold floor.

## 1. Two-tier currency

| | GOLD (scarce) | MATERIALS (abundant) |
|---|---|---|
| Comes from | Dailies (~285/day max w/ streak), spinner jackpot, small elite/boss kill gold, NPC material sales | **Every kill** (zone drop tables) + gathering (ore/crystal/fish) |
| Role | The pricing/settlement currency; what whales buy P2P | The volume economy; what crafting consumes |
| Server truth | `meta_wallets.currency`, `wallet_ledger`, `DAILY_EARN_CAP=5000` | bag/stash item rows |

**Kill gold is near-zero by design** (grunt 0, elite 2, boss 10 pre-multiplier).
Kills pay in zone materials:

| Zone | Common (60% minion) | Uncommon (25% elite) | Boss adds |
|---|---|---|---|
| Goblin Warrens (1-10) | goblin_hide (floor 3g) | warband_totem (12g) | beast_horn 40% |
| The Bonefields (10-20) | bone_shard (5g) | grave_iron (16g) | beast_horn 40% |
| Infernal Reach (20-40) | demon_essence (9g) | infernal_core (28g) | beast_horn 40% |
| Coliseum champion | — | — | champion_sigil 100% (80g floor) |

NPC `sellValue` is the **floor price**; the real market is P2P.

## 2. The demand treadmill (sinks that scale with activity)

1. **Gear durability** (implemented): every weapon has durability by rarity
   (60/80/100/120/150). **Dying costs `DEATH_DURABILITY_COST = 10`**; at 0 the
   weapon shatters. Repair at the Forge (gold fee = max(5, sellValue/2)).
2. **Tools** (implemented): mining needs a pickaxe, fishing a rod; every
   gather burns 1 use. Starter pair (60 uses) is free on spawn / 15g at the
   market; forged tier (200 uses) comes from materials. The gift never
   undermines the treadmill because tools wear out.
3. **Trial Keys** (implemented): coliseum tiers >5 consume a `trial_key`
   (forged: champion_sigil + 3 beast_horn + 100g). Content-as-consumable —
   the PoE maps insight on our ladder.
4. **Forge gold fees** (implemented): 10-300g per craft — a pure sink tied to
   progression appetite.
5. Existing: 5% P2P fee burn, cosmetic skins, meta upgrades, potions/food.
6. **Stash/market purity rule** (implemented): only PRISTINE durability items
   can be banked or listed — worn gear must be repaired first. Keeps market
   rows free of per-instance state AND feeds the repair sink.

## 3. The Forge (implemented)

At the blacksmith anvil beside the market (`MAP_FEATURES.forge`). Recipes in
`packages/sim/src/forge.ts` (the one data file to tune):
tools → weapons (each tier keyed to its zone's materials) → trial keys, plus
the repair action. Salvage (item → partial materials) is a planned follow-up.

## 4. Endgame ladder (replaces the removed depth system)

The **coliseum tier** is the progression axis: each champion kill raises the
tier (+60% power/reward, +3 levels), the run report carries the tier (legacy
wire name `depthReached` until the rebrand rename), and plausibility caps are
keyed on it (`maxCurrencyForRun(tier) = 300 + 100·tier`,
`maxXpForRun = 8000 + 4000·tier`, `MAX_PLAUSIBLE_TIER = 100`).

Planned (needs seasons; NOT built): per-tier first-clear gold bounties from a
finite seasonal pool, **numbered Coliseum Trophies** (first-ever clear of tier
N mints trophy #N — one per tier per season, tradeable: the fixed-supply
prestige asset class, earnable only through combat), seasonal leaderboard.

## 5. Token layer (unchanged shape — proven by Kintara)

- **The game only ever creates GOLD, never tokens.** No payout signer exists.
- **Gold → token is player-to-player**: Trading Post → Gold Exchange. Listings
  are **USD-quoted** (volatility insulation; settlement in $TOKEN at spot).
  Seller receives 95%, treasury 5%. Buy leg FAILS CLOSED (`503 phase2_locked`)
  until the Solana env + signature verification exist.
- **Token gate**: hold ≥ `TOKEN_GATE_AMOUNT` (TBD) to play.
- **Premium spends** (paid spins etc.): USD-quoted, **50% burn / 50% treasury**.
- Planned: **item↔token USD listings** — same 95/5 + locked-buy mechanics as
  gold, extending `market_listings` with an optional `usd_price`.

## 6. Pump.fun revenue layer (the piece that makes it hold)

Verified against Kintara's live setup (its KSTR engine claims creator fees
every 30s):

1. **Creator fees are the game's revenue faucet**: pump.fun pays the token
   creator a share of EVERY trade — token volume funds the treasury before
   in-game monetization even matters. Claiming must be automated (cron +
   kill switch + caps per guardrail #9 — fail closed).
2. **Treasury policy** (all % TBD at launch): split claimed revenue into
   (a) **token buyback** (supportive buy pressure — pump.fun's own playbook),
   (b) **gold-floor support** — the treasury programmatically BUYS players'
   gold listings on our own exchange. This is what creates Kintara's ~$0.70
   gold floor: players always have a buyer of last resort, funded purely by
   realized fees, and
   (c) the **seasonal prize pool** (finite — satisfies guardrail #1; funded by
   fees, never minted).
3. **The flywheel**: token volume → creator fees → treasury buys player gold →
   playtime has real dollar value → more players → more volume.

Everything here is automation over revenue already received — the game still
never mints or promises tokens.

## 7. Phase B (designed, not built)

- **PvP wagered duels**: two players stake gold in the coliseum; winner takes
  90%, **10% burned**. Pure combat-driven sink + spectacle. Requires
  anti-collusion controls (stake caps, matchmaking rating floor, per-day wager
  caps) before build.
- Guild wars, housing-analog scarce assets, salvage, seasons + trophy minting.

## 8. Anti-collapse guardrails (standing)

1. Every faucet capped + ledgered (`wallet_ledger`, `DAILY_EARN_CAP`,
   plausibility caps) — implemented.
2. No yield depends on player growth — a solo player on a dead server earns
   the same gold/hour.
3. The late-joiner fun test: a player joining in month 6 must have the same
   fun-per-hour and earn-per-hour as a day-1 player.
4. Sinks scale with activity automatically (durability/keys/fees burn more
   the more people play).
5. Watch weekly: gold minted vs destroyed (ledger), materials created vs
   consumed, gold-listing floor price, repair volume. `tools/econ_sim.mjs`
   sanity-checks faucet/sink balance offline.

## 9. Implementation state (2026-07-15)

| Piece | State |
|---|---|
| Depth system removal, tier ladder | ✅ shipped |
| Zone material drop tables, kill-gold ≈ 0 | ✅ shipped |
| Durability (`uses`), tools, death tax, pristine rule | ✅ shipped |
| Forge (craft/repair) + Trial Keys + key gate >T5 | ✅ shipped |
| Guide panel teaching all of the above | ✅ shipped |
| Item↔token USD listings | ▢ next (E5) |
| Salvage, trophies/seasons, PvP wagers | ▢ Phase B |
| Solana buy leg, creator-fee automation, treasury policy | ▢ launch prep (all values TBD) |
