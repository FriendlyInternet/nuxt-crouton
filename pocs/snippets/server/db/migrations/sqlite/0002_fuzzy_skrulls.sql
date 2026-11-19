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
DROP INDEX `domain_domain_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `domain_org_domain_uniq` ON `domain` (`organizationId`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_verified_uniq` ON `domain` (`domain`) WHERE "domain"."status" = 'verified';