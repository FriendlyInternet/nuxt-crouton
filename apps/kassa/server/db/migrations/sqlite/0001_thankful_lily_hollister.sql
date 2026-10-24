CREATE TABLE `sales_handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`orderId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_handovers_team_order_id_idx` ON `sales_handovers` (`teamId`,`orderId`);