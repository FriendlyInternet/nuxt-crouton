CREATE TABLE `sales_sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`device_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`reason` text NOT NULL,
	`lost_json` text NOT NULL,
	`kept_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sales_sync_conflicts_team` ON `sales_sync_conflicts` (`team_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sales_sync_pull_state` (
	`id` text PRIMARY KEY NOT NULL,
	`cursor` integer NOT NULL,
	`skip` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_sync_tombstones` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`team_id` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sales_sync_tombstones_entity` ON `sales_sync_tombstones` (`entity_type`,`entity_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_layout_configs` (
	`id` text NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`renderer` text NOT NULL,
	`tree` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`teamId`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_layout_configs`("id", "teamId", "name", "renderer", "tree", "createdAt", "updatedAt") SELECT "id", "teamId", "name", "renderer", "tree", "createdAt", "updatedAt" FROM `layout_configs`;--> statement-breakpoint
DROP TABLE `layout_configs`;--> statement-breakpoint
ALTER TABLE `__new_layout_configs` RENAME TO `layout_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `layout_configs_team_idx` ON `layout_configs` (`teamId`);--> statement-breakpoint
ALTER TABLE `sales_sync_status` ADD `team_id` text;--> statement-breakpoint
ALTER TABLE `sales_sync_status` ADD `last_pull_at` integer;