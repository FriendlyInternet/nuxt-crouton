-- Per-till heartbeat (#2725, epic #801). `id` now holds the paired device id
-- (the legacy single row keeps id 'live', team_id NULL); team_id scopes the
-- status read to the caller's team.
ALTER TABLE sales_sync_status ADD COLUMN team_id TEXT;
