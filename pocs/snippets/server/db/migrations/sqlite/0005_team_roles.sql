CREATE TABLE `organizationRole` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`role` text NOT NULL,
	`permission` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organizationRole_organizationId_idx` ON `organizationRole` (`organizationId`);--> statement-breakpoint
CREATE INDEX `organizationRole_role_idx` ON `organizationRole` (`role`);