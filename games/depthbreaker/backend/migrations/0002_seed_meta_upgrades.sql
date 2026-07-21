-- Phase 0 upgrade-tree catalog (Mirror-of-Night analog, deliberately small).
-- All 3 classes are free in Phase 0, so no class unlock rows are needed here.

INSERT INTO meta_upgrades (id, title, max_rank, cost_per_rank, prereq_id, effect) VALUES
  ('vitality',       'Vitality',       5, '{50,100,200,400,800}', NULL,       '{"stat":"hp","perRank":10}'),
  ('brawn',          'Brawn',          5, '{50,100,200,400,800}', NULL,       '{"stat":"attack","perRank":2}'),
  ('swiftness',      'Swiftness',      3, '{150,300,600}',        NULL,       '{"stat":"attackSpeedPct","perRank":2}'),
  ('fortune',        'Fortune',        3, '{200,400,800}',        NULL,       '{"stat":"metaCurrencyGainPct","perRank":5}'),
  ('death_defiance', 'Death Defiance', 1, '{1000}',               'vitality', '{"special":"revive","perRank":1}')
ON CONFLICT (id) DO NOTHING;
