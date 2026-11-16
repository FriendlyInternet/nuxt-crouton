CREATE TABLE `flow_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`collection` text NOT NULL,
	`label_field` text DEFAULT 'title',
	`parent_field` text DEFAULT 'parentId',
	`position_field` text DEFAULT 'position',
	`sync_enabled` integer DEFAULT false,
	`node_positions` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_flow_configs_team_id` ON `flow_configs` (`team_id`);--> statement-breakpoint
DROP INDEX `domain_domain_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `domain_org_domain_uniq` ON `domain` (`organizationId`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_verified_uniq` ON `domain` (`domain`) WHERE "domain"."status" = 'verified';