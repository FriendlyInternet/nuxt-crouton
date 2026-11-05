-- Till-side cursor for pulling config changes from the cloud (#815, epic #801).
-- Additive; only the till writes it.
CREATE TABLE IF NOT EXISTS sales_sync_pull_state (
  id TEXT PRIMARY KEY NOT NULL,
  cursor INTEGER NOT NULL,
  skip INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
