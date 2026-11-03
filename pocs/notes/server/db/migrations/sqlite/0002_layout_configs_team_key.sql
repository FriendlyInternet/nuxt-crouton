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
CREATE INDEX `layout_configs_team_idx` ON `layout_configs` (`teamId`);