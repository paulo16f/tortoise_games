-- P2P player marketplace, gold listings (Kintara model; see
-- docs/PHASE2_TOKEN_ECONOMY.md §3.3). Items are ESCROWED: listing moves them
-- out of the seller's stash into this row inside one transaction; buying moves
-- gold seller<-buyer and items row->buyer stash inside one transaction (the
-- WoCC two-table escrow lesson). Gold listings carry no fee; the Phase 2
-- gold-for-token listing type adds tx_signature + fee columns later.
CREATE TABLE market_listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id        text NOT NULL,
  count          integer NOT NULL CHECK (count > 0 AND count <= 999),
  price          bigint NOT NULL CHECK (price > 0 AND price <= 1000000),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled')),
  buyer_account  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_listings_open_idx ON market_listings (status, created_at DESC) WHERE status = 'open';
CREATE INDEX market_listings_seller_idx ON market_listings (seller_account, created_at DESC);
