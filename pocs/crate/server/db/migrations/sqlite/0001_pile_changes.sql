CREATE TABLE `layout_configs` (
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
CREATE INDEX `layout_configs_team_idx` ON `layout_configs` (`teamId`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_crate_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`groupId` text NOT NULL,
	`trackId` text,
	`pileId` text,
	`before` text,
	`after` text,
	`summary` text,
	`undoOf` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_crate_changes`("id", "teamId", "owner", "groupId", "trackId", "pileId", "before", "after", "summary", "undoOf", "createdAt", "updatedAt", "createdBy", "updatedBy") SELECT "id", "teamId", "owner", "groupId", "trackId", NULL, "before", "after", "summary", "undoOf", "createdAt", "updatedAt", "createdBy", "updatedBy" FROM `crate_changes`;--> statement-breakpoint
DROP TABLE `crate_changes`;--> statement-breakpoint
ALTER TABLE `__new_crate_changes` RENAME TO `crate_changes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;