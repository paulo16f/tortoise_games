-- Spinner free-spin cooldown, one row per account. The prize roll and item/gold
-- grant happen in the /internal/spinner/:accountId/spin route; this table only
-- persists the last free-spin time so the 24h cooldown survives sessions.
CREATE TABLE account_spins (
  account_id        uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_free_spin_at timestamptz
);
