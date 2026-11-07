CREATE TABLE IF NOT EXISTS `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text,
	`count` integer,
	`lastRequest` integer
);
