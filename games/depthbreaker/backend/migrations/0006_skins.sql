-- Cosmetic skins: account-wide ownership + a per-character equipped skin.
-- Buying grants ownership (a gold sink); equipping sets characters.skin_id.
-- "" (empty) = the class default, always available.
ALTER TABLE characters ADD COLUMN skin_id text NOT NULL DEFAULT '';

CREATE TABLE account_skins (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  skin_id    text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, skin_id)
);
