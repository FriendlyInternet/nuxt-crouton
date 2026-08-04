ALTER TABLE `sales_locations` ADD `requiresHandover` integer;--> statement-breakpoint
-- Existing locations keep behaving as they do today: they appear on a screen and
-- must be confirmed sent out. Drizzle's `$default(() => true)` is applied by the
-- APPLICATION on insert, not by the database, so without this backfill every
-- pre-existing row would read NULL and silently stop requiring confirmation —
-- orders would look delivered the moment they were placed.
UPDATE `sales_locations` SET `requiresHandover` = 1 WHERE `requiresHandover` IS NULL;
