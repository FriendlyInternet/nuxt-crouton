CREATE TABLE `crouton_events` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`operation` text NOT NULL,
	`collection_name` text NOT NULL,
	`item_id` text NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text DEFAULT '' NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `crouton_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`team_id` text,
	`user_id` text,
	`correlation_id` text,
	`metadata` text
);
