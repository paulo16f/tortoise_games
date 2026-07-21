-- Persistent character progression (MMO-lite axis): total XP accumulated across
-- all finished runs. Character level derives from this via the frozen xpCurve
-- (levelForTotalXp) — level itself is never stored, so the curve stays the
-- single source of truth. Credited in /internal/runs/:id/finish alongside the
-- wallet, inside the same idempotent transaction.
ALTER TABLE characters ADD COLUMN total_xp bigint NOT NULL DEFAULT 0 CHECK (total_xp >= 0);
