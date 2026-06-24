CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`printer_id` text NOT NULL,
	`printer_ip` text,
	`printer_port` integer NOT NULL,
	`printer_title` text,
	`location_id` text,
	`team_id` text,
	`event_id` text,
	`ref_type` text,
	`ref_id` text,
	`driver` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`print_mode` text NOT NULL,
	`error_message` text,
	`retry_count` text NOT NULL,
	`completed_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_print_jobs_drain` ON `print_jobs` (`status`,`driver`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_printer` ON `print_jobs` (`printer_id`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_ref` ON `print_jobs` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_source` ON `print_jobs` (`source`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`team_id` text,
	`event_id` text,
	`location_id` text,
	`title` text NOT NULL,
	`driver` text NOT NULL,
	`ip_address` text,
	`port` integer NOT NULL,
	`type` text,
	`status` integer NOT NULL,
	`show_prices` integer NOT NULL,
	`is_active` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_printers_source` ON `printers` (`source`);--> statement-breakpoint
CREATE INDEX `idx_printers_event` ON `printers` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_printers_location` ON `printers` (`location_id`);