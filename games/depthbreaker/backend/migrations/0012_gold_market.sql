-- Phase-2 scaffolding (PHASE2_TOKEN_ECONOMY.md §5.1), built off-chain first.
-- gold_listings: the Kintara-style gold exchange. Gold is ESCROWED out of the
-- seller's wallet at listing time (same escrow lesson as the item market);
-- buying settles on-chain in Phase 2 (tx_signature UNIQUE = replay brake) and
-- stays fail-closed (503) until then. usd_price is quoted by the seller.
CREATE TABLE IF NOT EXISTS gold_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gold_amount bigint NOT NULL CHECK (gold_amount > 0),
  usd_price numeric(12, 4) NOT NULL CHECK (usd_price > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled')),
  buyer_account uuid REFERENCES accounts(id),
  tx_signature text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gold_listings_open ON gold_listings(status, created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS gold_listings_seller ON gold_listings(seller_account, created_at);

-- token_ledger: every token-relevant event, written server-side only. Pre-
-- launch nothing writes here; the schema exists so Phase 2 wiring is additive.
CREATE TABLE IF NOT EXISTS token_ledger (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('spend', 'fee', 'burn_liability', 'burn_executed')),
  account_id uuid REFERENCES accounts(id),
  token_amount numeric(20, 9) NOT NULL,
  burn_amount numeric(20, 9) NOT NULL DEFAULT 0,
  treasury_amount numeric(20, 9) NOT NULL DEFAULT 0,
  tx_signature text UNIQUE,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- payment_intents: server-created quotes for premium spends (paid spins etc).
-- Fail-closed: no route creates intents until PREMIUM_SPENDS_ENABLED + Solana
-- env exist. tx_signature UNIQUE enforces one-payment-one-intent.
CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  usd_price numeric(12, 4) NOT NULL,
  token_amount numeric(20, 9),
  quote_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  tx_signature text UNIQUE
);
