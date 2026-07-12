-- Fresh 4-class roster (POLYGON Dark Fortress heroes): knight / reaper / cleric /
-- necromancer, replacing bruiser / mage / warden. Remap any existing characters
-- from the old ids, then swap the class_id CHECK constraint. reaper is new.
-- Drop the old CHECK first (inline column CHECKs are auto-named
-- <table>_<column>_check by Postgres) so the remap below isn't rejected by it.
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_class_id_check;

UPDATE characters SET class_id = CASE class_id
  WHEN 'bruiser' THEN 'knight'
  WHEN 'warden'  THEN 'cleric'
  WHEN 'mage'    THEN 'necromancer'
  ELSE class_id
END;

ALTER TABLE characters ADD CONSTRAINT characters_class_id_check
  CHECK (class_id IN ('knight', 'reaper', 'cleric', 'necromancer'));
