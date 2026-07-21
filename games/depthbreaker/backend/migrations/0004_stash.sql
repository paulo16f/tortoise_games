-- Account-scoped persistent stash (the "bank"): stackable item storage that
-- survives run resets, deposited/withdrawn at the hub via the zone server.
-- One row per item type; the slot cap is the number of distinct rows, checked
-- in the route inside a transaction. inventory_items (per-character, rolled
-- stats) stays reserved for future per-instance gear persistence.
CREATE TABLE stash_items (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id    text NOT NULL,
  count      integer NOT NULL CHECK (count > 0 AND count <= 999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, item_id)
);
