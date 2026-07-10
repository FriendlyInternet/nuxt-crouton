CREATE TABLE `print_transports` (
	`event_id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`transport` text NOT NULL,
	`last_spooler_poll_at` text,
	`last_drainer_tick_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
