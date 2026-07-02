# Pump.fun + Solana Launch Manual

This is the operational launch manual for a Tortoise Games title that uses a Pump.fun/SPL token on Solana. It is written for real launches, not mock demos.

## Source Facts Checked On 2026-07-02

- Claude Fable 5 is Anthropic's highest-capability model option for complex generation: https://platform.claude.com/docs/en/about-claude/models/overview
- PumpPortal supports programmatic token creation, but Pump.fun no longer supports direct metadata uploads to the old API. Programmatic creation requires external IPFS metadata hosting: https://pumpportal.fun/creation/
- PumpPortal local trading API returns serialized transactions for the app to sign and submit: https://pumpportal.fun/local-trading-api/trading-api/
- PumpPortal real-time streams can monitor token events and trades, but should not be the only accounting source: https://pumpportal.fun/data-api/real-time/
- Solana `getTransaction` can inspect confirmed transactions for payment verification: https://solana.com/docs/rpc/http/gettransaction
- Vercel Cron behavior depends on plan limits and schedule support: https://vercel.com/docs/cron-jobs

Recheck these before production launch.

## Phase 0: Complete The Game Launch Spec

Before token creation or deployment, complete:

```txt
docs/FABLE_GAME_LAUNCH_SPEC.md
```

Do not launch with `TBD` in:

- token mint;
- treasury wallet;
- RPC provider;
- payout mode;
- health checks;
- canary plan;
- power formula;
- spend split;
- payout caps.

## Phase 1: Token Creation

### Path A: Manual Pump.fun Creation

Use this as the default for first launches.

Prepare:

- token name;
- token symbol;
- square PNG image;
- short description with no financial promises;
- game website URL;
- X/Twitter URL if used;
- Telegram/Discord URL if used;
- initial buy amount and wallet funding.

Process:

1. Open Pump.fun.
2. Create coin manually.
3. Confirm transaction in wallet.
4. Copy the token mint.
5. Copy the Pump.fun coin URL.
6. Save both in the launch spec and env plan.

### Path B: Advanced PumpPortal API Creation

Use only if automation is needed and keys are handled safely.

Requirements:

- PumpPortal API key if using lightning transaction API;
- local Solana RPC if using local transaction API;
- generated mint keypair;
- external IPFS provider for image and metadata;
- secure handling of signer keys;
- dry run or dev wallet rehearsal before mainnet.

Rules:

- Do not assume direct Pump.fun metadata upload works.
- Upload image and metadata to IPFS first.
- Store no private key in docs, prompts, logs, or public env names.
- Record mint and transaction signature after creation.

## Phase 2: Treasury And Accounts

Create a dedicated treasury wallet.

Rules:

- Do not use a personal wallet as the production treasury.
- Store the private key only in server-side env.
- Never expose treasury private key through `NEXT_PUBLIC_` variables.
- Create or verify the treasury associated token account for the token mint.
- Send a tiny token amount to the treasury if needed to initialize the token account.

Required env:

```bash
TOKEN_MINT=
TOKEN_SYMBOL=
TOKEN_DECIMALS=6
NEXT_PUBLIC_BUY_URL=
TREASURY_WALLET=
TREASURY_PRIVATE_KEY=
```

## Phase 3: Server Readiness

Before deploy, the game must implement or import:

- session-based wallet auth;
- nonce storage;
- player storage;
- payment intent storage;
- payout request storage if payouts are enabled;
- season ledger;
- advisory locks or equivalent;
- token gate checks;
- `/api/health`.

If any of these are missing, public launch is blocked.

## Phase 4: Payments

For token spends:

1. Server creates a payment intent.
2. Server defines amount, mint, destination, expiry, and benefit.
3. Client signs and submits the transaction.
4. Client sends transaction signature back.
5. Server verifies transaction on-chain.
6. Server grants benefit once.
7. Server records signature as used.
8. Spend split is recorded.

Reject:

- wrong mint;
- wrong amount;
- wrong decimals;
- wrong destination;
- wrong authority;
- failed transaction;
- expired intent;
- repeated signature;
- wallet mismatch between session and transaction.

## Phase 5: Automatic Payouts

Automatic payouts are allowed, but only after controls are implemented.

Required env:

```bash
REWARDS_PAYOUTS_ENABLED=false
MAX_PAYOUT_PER_CLAIM=
DAILY_PAYOUT_CAP=
PAYOUT_KILL_SWITCH=true
```

Required behavior:

- payout request is created server-side;
- wallet comes from session;
- withdraw gate is checked server-side;
- claimable reward comes from finite pool accounting;
- per-claim cap is enforced;
- daily cap is enforced;
- duplicate payout requests are idempotent;
- Solana transaction signature is stored;
- payout status is tracked;
- `PAYOUT_KILL_SWITCH=true` blocks new payouts immediately.

Launch rule:

- Keep `REWARDS_PAYOUTS_ENABLED=false` until devnet or private test passes.
- Keep `PAYOUT_KILL_SWITCH=true` until the canary window.
- For mainnet canary, enable only with tiny caps.
- After canary, remove the kill switch only deliberately and raise caps gradually.

## Phase 6: Health Check

`/api/health` must return launch-ready status.

Required checks:

```txt
postgres
rpcConfigured
rpcLive
tokenMintConfigured
mintAccountExists
mintOwnedBySplTokenProgram
treasuryWalletConfigured
treasuryTokenAccountExists
sessionSecretConfigured
payoutSwitchExplicit
payoutCapsConfiguredWhenEnabled
```

Return:

- 200 when ready;
- 503 when any launch-critical check fails.

## Phase 7: Mainnet Canary

Do not share the public link before this passes.

Checklist:

- [ ] Open production game with wallet on mainnet.
- [ ] Sign in with signed-message auth.
- [ ] Non-holder wallet cannot access gated earning paths.
- [ ] Holder wallet can access intended game paths.
- [ ] Server ignores wallet fields in request body.
- [ ] Earn gate blocks a fresh/low-progress wallet.
- [ ] Payment intent flow grants exactly one benefit.
- [ ] Reused payment signature is rejected.
- [ ] Spend split is recorded.
- [ ] `/api/health` is ready.
- [ ] If payouts are enabled, execute one tiny payout.
- [ ] Reusing payout request does not double-pay.
- [ ] Per-claim cap blocks oversized withdrawal.
- [ ] Daily cap blocks excess withdrawal.
- [ ] Kill switch blocks new payouts.
- [ ] Logs contain no private keys or secrets.

## Phase 8: Public Launch

Share:

- Pump.fun coin URL;
- game URL;
- plain-language game description;
- support/community link.

Do not share:

- financial promises;
- guaranteed earnings;
- private keys;
- treasury private operational details;
- unaudited payout guarantees.

## Phase 9: Post-Launch Operations

Daily:

- monitor health endpoint;
- monitor Solana RPC errors;
- review payout logs;
- review failed payment confirmations;
- check treasury token balance;
- check burn liability ledger.

Per season:

- close previous pool;
- export accounting;
- top up or seed next pool;
- reset season ledger;
- update public season notes.

Incident actions:

- set payout kill switch;
- lower payout caps;
- disable new payment intents if needed;
- preserve logs;
- rotate exposed secrets;
- publish a clear status update.
