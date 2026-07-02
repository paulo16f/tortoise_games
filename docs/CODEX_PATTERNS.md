# Codex Patterns For Solana Game Launches

These patterns define how generated games must handle auth, state, payments, payouts, health, and deployment. They are guardrails, not creative limits.

## 1. Session-Based Wallet Auth

Use SIWS or an equivalent signed-message login flow. Login proves wallet ownership without requiring a token transfer.

Required flow:

```txt
GET /api/auth/nonce
  server creates nonce with wallet, message, expiry, used_at=null

wallet.signMessage(message)

POST /api/auth/verify
  server verifies signature
  server consumes nonce exactly once
  server sets httpOnly session cookie

POST /api/game/action
  server verifies session cookie
  server derives wallet from session only
```

Rules:

- Nonces must be single-use and short-lived.
- Session cookies must be httpOnly and secure in production.
- Action handlers must ignore wallet values from request bodies.
- Session verification must fail closed.

## 2. Database And Locks

Every production game needs durable server-side state.

Minimum tables:

```sql
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  wallet TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  signature TEXT UNIQUE,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  signature TEXT UNIQUE,
  amount_raw TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Use advisory locks or equivalent transactional locks for:

- wallet state mutations;
- payment confirmation;
- payout creation;
- season pool changes;
- burn liability updates.

## 3. Server-Created Payment Intents

The client must never decide payment amount, destination, mint, or benefit.

Required flow:

```txt
POST /api/payments/intent
  server defines mint, source expectation, destination, amount, decimals, benefit, expiry
  server returns transaction or payment instructions

client signs and sends transaction

POST /api/payments/confirm
  server reads session wallet
  server fetches transaction from Solana RPC
  server verifies all fields
  server grants benefit once
```

Verification must check:

- transaction exists and succeeded;
- expected signature is present;
- SPL token instruction type is correct;
- mint matches intent;
- amount and decimals match intent;
- source and destination match intent;
- authority matches session wallet;
- signature was not used before.

`getTransaction` is an appropriate Solana RPC method for inspecting confirmed transactions. Treat null or incomplete transaction data as not confirmed.

## 4. Token Gate

Token gate checks must be server-side.

Use a Solana RPC token-account query to verify whether the session wallet holds the required Pump.fun/SPL token amount. The client can display wallet state, but server checks decide access, earning, and withdrawal.

Common gates:

- hold token to access game;
- hold token to earn;
- reach server-side power threshold to earn;
- reach higher server-side threshold to withdraw.

## 5. Automatic Payout Safety

Automatic payouts are allowed only with strict controls.

Required controls:

- dedicated treasury wallet;
- signer secret stored only server-side;
- `REWARDS_PAYOUTS_ENABLED` kill switch;
- `MAX_PAYOUT_PER_CLAIM`;
- `DAILY_PAYOUT_CAP`;
- server-side withdraw gate;
- explicit `PAYOUT_KILL_SWITCH` where `true` means new payouts are blocked;
- idempotent payout records;
- unique transaction signature;
- status tracking: `pending`, `sent`, `confirmed`, `failed`, `blocked`;
- structured logs for every payout attempt;
- manual canary before public launch.

If any control is missing, payouts stay disabled. The game may still show server-side claimable rewards, but it must not send tokens automatically.

## 6. Health Endpoint

Every game must expose `/api/health`.

Minimum checks:

```txt
postgres configured and reachable
RPC_URL configured
Solana RPC responds
TOKEN_MINT configured
mint account exists
mint owner is SPL token program
treasury wallet configured
treasury token account exists
SESSION_SECRET configured
payout controls configured if payouts are enabled
REWARDS_PAYOUTS_ENABLED state is explicit
```

Return 503 when required checks fail.

Do not share public links until health is ready and mainnet canary is complete.

## 7. Production Config

Minimum env set:

```bash
POSTGRES_URL=
SESSION_SECRET=
RPC_URL=
TOKEN_MINT=
TOKEN_SYMBOL=
TOKEN_DECIMALS=6
GATE_AMOUNT=
NEXT_PUBLIC_BUY_URL=
TREASURY_WALLET=
TREASURY_PRIVATE_KEY=
CRON_SECRET=
REWARDS_PAYOUTS_ENABLED=false
MAX_PAYOUT_PER_CLAIM=
DAILY_PAYOUT_CAP=
PAYOUT_KILL_SWITCH=true
```

Rules:

- Missing production env must fail closed.
- No private key may use a `NEXT_PUBLIC_` prefix.
- `PAYOUT_KILL_SWITCH=true` means new payouts are blocked.
- Use dedicated treasury keys, not a personal wallet.
- Rotate keys if they were pasted into prompts, logs, screenshots, or public files.

## 8. Deployment Notes

Serverless deployments are good for request-driven games. They are not reliable always-on simulation workers by default.

Vercel Cron exists, but cron frequency and availability depend on the Vercel plan. Design reward settlement so the game remains correct even if scheduled jobs are delayed. For true live worlds, WebSockets, or always-on settlement, use a deployment target with long-running processes.
