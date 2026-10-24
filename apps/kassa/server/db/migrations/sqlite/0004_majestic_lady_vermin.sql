-- REMOVED: drizzle regenerated a `DROP TABLE sales_handovers` here (#1769).
-- `0003_drop_sales_handovers.sql` (#1855) is HAND-WRITTEN and ships no snapshot, so
-- the snapshot chain still carried the table and drizzle re-proposed dropping it —
-- without `IF EXISTS`, so it would abort on every database where 0003 already ran.
-- 0003 owns that drop and is idempotent; this migration's snapshot no longer lists
-- the table, so the chain is healed from here on. (The #1717 hazard exactly: a
-- corrective migration that never made it back into the schema source.)

-- BACKFILL BEFORE THE REBUILD. Hand-added ahead of drizzle's output on purpose.
--
-- This migration makes sales_products.categoryId/locationId NOT NULL. The rebuild
-- below is an INSERT..SELECT, so it aborts with `NOT NULL constraint failed` on the
-- FIRST row that has neither — and every kassa product had a NULL locationId,
-- because the app's schema copy never carried `required: true` (that omission is
-- what routed order items to no kitchen screen at all, #1766). Shipping the rebuild
-- alone is exactly how #1620 blocked a prod deploy. So the data is made legal first.
--
-- A product must be prepped SOMEWHERE. Where the operator never said, it gets a
-- default station they can rename or reassign — that is recoverable, whereas
-- dropping the rows or failing the deploy is not.

-- 1. Give every event that has an orphaned product a station to point at, but only
--    if it has none at all; an event that already defined stations keeps them.
INSERT INTO `sales_locations` (`id`, `teamId`, `owner`, `eventId`, `title`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`)
SELECT
  'loc-default-' || p.`eventId`,
  p.`teamId`,
  p.`owner`,
  p.`eventId`,
  'Keuken',
  CAST(strftime('%s','now') AS INTEGER),
  CAST(strftime('%s','now') AS INTEGER),
  'migration-1769',
  'migration-1769'
FROM (
  SELECT `eventId`, MIN(`teamId`) AS `teamId`, MIN(`owner`) AS `owner`
  FROM `sales_products`
  WHERE `locationId` IS NULL OR `locationId` = ''
  GROUP BY `eventId`
) p
WHERE NOT EXISTS (SELECT 1 FROM `sales_locations` l WHERE l.`eventId` = p.`eventId`);--> statement-breakpoint

-- 2. Point every station-less product at its event's first station.
UPDATE `sales_products`
SET `locationId` = (
  SELECT l.`id` FROM `sales_locations` l
  WHERE l.`eventId` = `sales_products`.`eventId`
  ORDER BY l.`createdAt`, l.`id` LIMIT 1
)
WHERE `locationId` IS NULL OR `locationId` = '';--> statement-breakpoint

-- 3. Same for categoryId. No kassa row needs this today, but the column is becoming
--    NOT NULL too and an unguarded rebuild would fail on any deployment that does.
INSERT INTO `sales_categories` (`id`, `teamId`, `owner`, `eventId`, `title`, `displayOrder`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`)
SELECT
  'cat-default-' || p.`eventId`,
  p.`teamId`,
  p.`owner`,
  p.`eventId`,
  'Overige',
  0,
  CAST(strftime('%s','now') AS INTEGER),
  CAST(strftime('%s','now') AS INTEGER),
  'migration-1769',
  'migration-1769'
FROM (
  SELECT `eventId`, MIN(`teamId`) AS `teamId`, MIN(`owner`) AS `owner`
  FROM `sales_products`
  WHERE `categoryId` IS NULL OR `categoryId` = ''
  GROUP BY `eventId`
) p
WHERE NOT EXISTS (SELECT 1 FROM `sales_categories` c WHERE c.`eventId` = p.`eventId`);--> statement-breakpoint

UPDATE `sales_products`
SET `categoryId` = (
  SELECT c.`id` FROM `sales_categories` c
  WHERE c.`eventId` = `sales_products`.`eventId`
  ORDER BY c.`displayOrder`, c.`id` LIMIT 1
)
WHERE `categoryId` IS NULL OR `categoryId` = '';--> statement-breakpoint

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sales_products` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`eventId` text NOT NULL,
	`categoryId` text NOT NULL,
	`locationId` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`price` real NOT NULL,
	`isActive` integer,
	`requiresRemark` integer,
	`remarkPrompt` text,
	`hasOptions` integer,
	`multipleOptionsAllowed` integer,
	`options` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sales_products`("id", "teamId", "owner", "order", "eventId", "categoryId", "locationId", "title", "description", "price", "isActive", "requiresRemark", "remarkPrompt", "hasOptions", "multipleOptionsAllowed", "options", "createdAt", "updatedAt", "createdBy", "updatedBy") SELECT "id", "teamId", "owner", "order", "eventId", "categoryId", "locationId", "title", "description", "price", "isActive", "requiresRemark", "remarkPrompt", "hasOptions", "multipleOptionsAllowed", "options", "createdAt", "updatedAt", "createdBy", "updatedBy" FROM `sales_products`;--> statement-breakpoint
DROP TABLE `sales_products`;--> statement-breakpoint
ALTER TABLE `__new_sales_products` RENAME TO `sales_products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;