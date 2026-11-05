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
ALTER TABLE `sales_sync_status` ADD `team_id` text;--> statement-breakpoint
ALTER TABLE `sales_sync_status` ADD `last_pull_at` integer;