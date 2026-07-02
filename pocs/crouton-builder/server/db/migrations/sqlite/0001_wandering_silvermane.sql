CREATE TABLE `layout_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`renderer` text NOT NULL,
	`tree` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `layout_configs_team_idx` ON `layout_configs` (`teamId`);