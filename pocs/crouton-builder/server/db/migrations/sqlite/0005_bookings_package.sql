CREATE TABLE `bookings_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`location` text NOT NULL,
	`date` integer NOT NULL,
	`slot` text NOT NULL,
	`group` text,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings_emaillogs` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`bookingId` text,
	`templateId` text,
	`recipientEmail` text NOT NULL,
	`triggerType` text NOT NULL,
	`status` text NOT NULL,
	`sentAt` text,
	`error` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings_emailtemplates` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`fromEmail` text NOT NULL,
	`triggerType` text NOT NULL,
	`recipientType` text NOT NULL,
	`isActive` integer,
	`daysOffset` integer,
	`locationId` text,
	`translations` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`color` text,
	`street` text,
	`zip` text,
	`city` text,
	`location` text,
	`content` text,
	`allowedMemberIds` text,
	`slots` text,
	`openDays` text,
	`slotSchedule` text,
	`blockedDates` text,
	`offerFullDay` integer,
	`inventoryMode` integer,
	`quantity` integer,
	`maxBookingsPerMonth` integer,
	`translations` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`statuses` text,
	`groups` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
