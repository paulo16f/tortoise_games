-- Daily-claim streaks (Kintara-style retention): one row per account tracking
-- the last UTC day a daily quest was claimed and the current consecutive-day
-- streak. Advanced inside the claim transaction (see /internal/dailies claim).
CREATE TABLE IF NOT EXISTS account_daily_streaks (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_claim_date text NOT NULL DEFAULT '',
  streak integer NOT NULL DEFAULT 0 CHECK (streak >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
