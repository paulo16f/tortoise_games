# Economy Laws

These are invariants for every Tortoise Games title. They are not genre templates. They are the accounting rules that allow Claude Fable to create many kinds of games without breaking token safety.

## Law 1: Real Rewards Come From A Finite Seasonal Pool

Claimable token rewards must always debit a finite pool.

```txt
SEASON_POOL = seeded token amount
EMISSION_RATE = SEASON_POOL / SEASON_DURATION_SECONDS
player_share = player_power / total_active_power
earned = min(EMISSION_RATE * elapsed_seconds * player_share, pool_remaining)
```

Creative rewards may be presented as:

- idle income;
- loot drops;
- quest rewards;
- race prizes;
- boss drops;
- farm harvests;
- tournament prizes;
- guild rewards;
- card battle rewards;
- territory control rewards.

Under the hood, they all debit the same finite seasonal pool or a documented sub-pool funded by the season pool.

Blocked:

- minting per kill, click, quest, or harvest;
- uncapped emission;
- reward formulas with no pool cap;
- rewards calculated only in the browser.

## Law 2: Every Token Spend Uses A Split

Every in-game spend of the Pump.fun/SPL token must be accounted with the same split.

```txt
40% burn or burn-liability ledger
40% recycled into the seasonal pool
20% treasury
```

If immediate on-chain burn is not implemented, record the burn amount as a liability and batch it later. Do not describe a spend as burned unless the burn transaction exists or the burn liability is tracked.

Spend examples:

- item upgrades;
- energy refills;
- crafting;
- battle entry;
- land expansion;
- tournament entry;
- cosmetics;
- skip timers;
- guild boosts.

Every spend must call the shared economy split function or an equivalent audited implementation.

## Law 3: The Server Is The Clock

Rewards settle on the server. The browser may display estimates, but the server value is final.

Required action-handler order:

1. verify session;
2. derive wallet from session;
3. acquire lock for the wallet or relevant ledger;
4. load state;
5. settle rewards;
6. validate the requested action;
7. mutate state;
8. save state and ledger changes.

For Vercel-style serverless apps, settlement happens when the player makes requests unless a reliable scheduled/worker system exists. For always-on or WebSocket games, use a deployment target with long-running workers and still keep action handlers server-authoritative.

## Law 4: Earning And Withdrawal Require Gates

Each game must have at least:

| Gate | Required purpose |
|---|---|
| Token gate | Optional access rule based on holding the Pump.fun token |
| Earn gate | Minimum server-side progress before earning real rewards |
| Withdraw gate | Higher progress threshold before payout |
| Per-claim cap | Maximum payout per request |
| Daily cap | Maximum payout per wallet per day |
| Kill switch | Immediate payout disable control |

Recommended defaults for the first production canary:

```txt
REWARDS_PAYOUTS_ENABLED=false until canary
MAX_PAYOUT_PER_CLAIM=small value
DAILY_PAYOUT_CAP=small value
WITHDRAW_FEE_PERCENT=5
```

The exact numbers are game-specific, but they must be explicit in the Game Launch Spec.

## Law 5: Power Is One Server-Side Number

The game can have many stats, but reward share must reduce to one server-side `power` value.

Examples only:

| Game type | Possible power formula |
|---|---|
| RPG | `gearScore + zoneLevel * 100 + bossKills * 5` |
| Strategy | `territoryScore + unitPower + cappedRankBonus` |
| Farming | `landTier * 100 + harvestScore + machineryPower` |
| Racing | `carRating + trainingScore + seasonRaceRating` |
| Card game | `collectionPower + rankedEloBonus + tournamentTier` |
| Social/guild | `personalPower + cappedGuildContribution` |
| Idle | `upgradeLevel * 100 + prestigeScore` |

Power must be:

- calculated on the server;
- updated when state changes;
- bounded enough to avoid runaway whales or sybil farming;
- documented in `docs/FABLE_GAME_LAUNCH_SPEC.md`.

## Compliance Checklist

Before a game can launch:

- [ ] All real rewards debit a finite pool.
- [ ] Every token spend uses burn/recycle/treasury accounting.
- [ ] Every state-changing handler settles server-side first.
- [ ] Client reward previews are marked non-authoritative.
- [ ] Earn gate and withdraw gate exist.
- [ ] Per-claim and daily payout caps exist.
- [ ] Payout kill switch exists.
- [ ] Power formula is server-side and documented.
- [ ] Pool, power, spend, and payout mutations are protected by locks or equivalent concurrency control.
- [ ] Marketing copy avoids promises of profit, guaranteed yield, or investment returns.

