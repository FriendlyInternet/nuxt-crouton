-- Per-till pull time and edits that lost a conflict (#816, epic #801).
-- Additive; cloud-only.
ALTER TABLE sales_sync_status ADD COLUMN last_pull_at INTEGER;
CREATE TABLE IF NOT EXISTS sales_sync_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  device_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  lost_json TEXT NOT NULL,
  kept_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_sync_conflicts_team ON sales_sync_conflicts(team_id, created_at);
