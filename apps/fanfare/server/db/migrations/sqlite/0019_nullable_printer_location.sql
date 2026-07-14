-- Corrective: sales_printers.locationId must be NULLABLE (receipt printers store
-- NULL — they ignore it; routing reads it for kitchen printers only). Migration
-- 0016 wrongly rebuilt the table with locationId NOT NULL (a schema-drift
-- regression, undoing 0011_rainy_zemo). 0016 is fixed in place for envs that
-- hadn't applied it; this migration heals envs that already ran the bad 0016
-- (staging) by rebuilding with the column nullable. Redundant-but-harmless where
-- locationId is already nullable.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sales_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`locationId` text,
	`title` text NOT NULL,
	`ipAddress` text NOT NULL,
	`port` text,
	`status` text,
	`type` text,
	`driver` text,
	`config` text,
	`showPrices` integer,
	`isActive` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_sales_printers`("id", "teamId", "owner", "eventId", "locationId", "title", "ipAddress", "port", "status", "type", "driver", "config", "showPrices", "isActive", "createdAt", "updatedAt", "createdBy", "updatedBy") SELECT "id", "teamId", "owner", "eventId", "locationId", "title", "ipAddress", "port", "status", "type", "driver", "config", "showPrices", "isActive", "createdAt", "updatedAt", "createdBy", "updatedBy" FROM `sales_printers`;--> statement-breakpoint
DROP TABLE `sales_printers`;--> statement-breakpoint
ALTER TABLE `__new_sales_printers` RENAME TO `sales_printers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
