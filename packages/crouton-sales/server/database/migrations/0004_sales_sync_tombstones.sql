-- Delete markers for synced config rows (#814, epic #801).
-- Config deletes are hard deletes; a marker per deleted row lets a delete sync
-- and lose or win a conflict. Additive; no existing query reads it.
CREATE TABLE IF NOT EXISTS sales_sync_tombstones (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_sync_tombstones_entity ON sales_sync_tombstones(entity_type, entity_id);
