-- Send-out confirmation per location (#1851). Hand-written, matching
-- 0001_print_transports: the fixture's 0000 is generated, later ones are added
-- by hand as the package schema grows.
--
-- The backfill mirrors kassa's: drizzle's `$default(() => true)` runs in the
-- APPLICATION on insert, not in the database, so an ALTER alone leaves existing
-- rows NULL — which would read as "no confirmation needed".
ALTER TABLE `sales_locations` ADD `requiresHandover` integer;--> statement-breakpoint
UPDATE `sales_locations` SET `requiresHandover` = 1 WHERE `requiresHandover` IS NULL;
