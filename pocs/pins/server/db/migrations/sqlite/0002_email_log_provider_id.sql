ALTER TABLE `auth_email_log` ADD `providerId` text;--> statement-breakpoint
CREATE INDEX `auth_email_log_provider_idx` ON `auth_email_log` (`providerId`);
