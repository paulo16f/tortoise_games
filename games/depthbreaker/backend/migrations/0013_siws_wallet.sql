-- SIWS wallet linking (PHASE2_TOKEN_ECONOMY.md §5.2, AGENTS.md Law 5): a
-- signed-message flow binds a Solana wallet to an EXISTING account (guest or
-- email — the upgrade-in-place pattern). No token transfer is ever part of
-- login. One wallet per account, one account per wallet.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wallet text UNIQUE;

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_nonces_account ON auth_nonces(account_id, created_at);
