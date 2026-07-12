-- Wallet ledger: an append-only record of every gold grant (positive amounts)
-- with an optional unique ref for idempotency. Powers the server-enforced
-- per-account DAILY EARN CAP — the anti-abuse floor required before any real
-- token payout can ever be wired (AGENTS.md: caps, idempotency, logs).
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL DEFAULT '',
  ref text,
  date_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_ref_unique ON wallet_ledger(ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallet_ledger_account_day ON wallet_ledger(account_id, date_key);
