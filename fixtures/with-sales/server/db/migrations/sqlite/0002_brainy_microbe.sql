CREATE TABLE `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text,
	`count` integer,
	`lastRequest` integer
);
