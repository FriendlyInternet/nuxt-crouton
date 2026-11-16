DROP INDEX `domain_domain_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `domain_org_domain_uniq` ON `domain` (`organizationId`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_verified_uniq` ON `domain` (`domain`) WHERE "status" = 'verified';
