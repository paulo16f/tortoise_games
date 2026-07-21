-- Per-account daily quest progress. One row per (account, day, quest); the
-- active quest ids for a day are derived deterministically from the date by
-- the shared sim (dailyQuestsFor), so the backend only stores progress + the
-- claimed flag. Rows for past days are harmless history (can be pruned later).
CREATE TABLE account_daily_quests (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date_key   text NOT NULL,                 -- "YYYY-MM-DD" (UTC)
  quest_id   text NOT NULL,
  progress   integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  claimed    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, date_key, quest_id)
);
