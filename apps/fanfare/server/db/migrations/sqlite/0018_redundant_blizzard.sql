-- layout_configs is schema catch-up drift (fanfare extends @fyit/crouton-layout
-- but never generated its migration), riding along with print_transports (#1324).
-- IF NOT EXISTS because a deployed env may already carry the table.
CREATE TABLE IF NOT EXISTS `layout_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`renderer` text NOT NULL,
	`tree` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `layout_configs_team_idx` ON `layout_configs` (`teamId`);--> statement-breakpoint
CREATE TABLE `print_transports` (
	`event_id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`transport` text NOT NULL,
	`last_spooler_poll_at` text,
	`last_drainer_tick_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
