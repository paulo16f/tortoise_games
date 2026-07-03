-- Depthbreaker durable schema (design doc §7.3).
-- Applied by src/db/migrate.ts inside a transaction. schema_migrations is
-- created by the migration runner itself.

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('guest', 'email')),
  email         text,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT email_accounts_have_credentials
    CHECK (kind <> 'email' OR (email IS NOT NULL AND password_hash IS NOT NULL))
);

CREATE UNIQUE INDEX accounts_email_unique ON accounts (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- SHA-256 hex of the opaque token; the raw token is never stored.
  token_hash text NOT NULL UNIQUE,
  family     uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family);
CREATE INDEX refresh_tokens_account_idx ON refresh_tokens (account_id);

CREATE TABLE characters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 20),
  class_id   text NOT NULL CHECK (class_id IN ('bruiser', 'mage', 'warden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX characters_account_idx ON characters (account_id);

CREATE TABLE meta_wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  currency   bigint NOT NULL DEFAULT 0 CHECK (currency >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Static upgrade catalog (seeded by 0002); ranks purchased per account below.
CREATE TABLE meta_upgrades (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  max_rank      int NOT NULL CHECK (max_rank >= 1),
  cost_per_rank bigint[] NOT NULL,
  prereq_id     text REFERENCES meta_upgrades(id),
  effect        jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE account_upgrades (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  upgrade_id text NOT NULL REFERENCES meta_upgrades(id),
  rank       int NOT NULL CHECK (rank >= 1),
  PRIMARY KEY (account_id, upgrade_id)
);

CREATE TABLE account_unlocks (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unlock_id   text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, unlock_id)
);

CREATE TABLE runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- uint32 dungeon seed (fits comfortably in bigint).
  seed            bigint NOT NULL CHECK (seed >= 0 AND seed < 4294967296),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'dead', 'complete', 'abandoned')),
  depth_reached   int NOT NULL DEFAULT 0 CHECK (depth_reached >= 0),
  xp_earned       bigint NOT NULL DEFAULT 0 CHECK (xp_earned >= 0),
  currency_earned bigint NOT NULL DEFAULT 0 CHECK (currency_earned >= 0),
  loot            jsonb NOT NULL DEFAULT '[]',
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE INDEX runs_character_idx ON runs (character_id, started_at DESC);
-- One active run per character.
CREATE UNIQUE INDEX runs_one_active_per_character ON runs (character_id) WHERE status = 'active';

-- Schema ready for per-item persistence; Phase 0 writes run summaries only.
CREATE TABLE inventory_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  base_item_id    text NOT NULL,
  rarity          text NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  rolled_stats    jsonb NOT NULL DEFAULT '{}',
  acquired_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_items_character_idx ON inventory_items (character_id);
