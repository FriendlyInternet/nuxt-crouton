CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`idToken` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE INDEX `account_provider_idx` ON `account` (`providerId`,`accountId`);--> statement-breakpoint
CREATE TABLE `auth_email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text,
	`emailType` text NOT NULL,
	`recipientEmail` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`sentAt` integer,
	`metadata` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_email_log_org_idx` ON `auth_email_log` (`organizationId`);--> statement-breakpoint
CREATE INDEX `auth_email_log_type_idx` ON `auth_email_log` (`emailType`);--> statement-breakpoint
CREATE INDEX `auth_email_log_status_idx` ON `auth_email_log` (`status`);--> statement-breakpoint
CREATE INDEX `auth_email_log_recipient_idx` ON `auth_email_log` (`recipientEmail`);--> statement-breakpoint
CREATE INDEX `auth_email_log_created_idx` ON `auth_email_log` (`createdAt`);--> statement-breakpoint
CREATE TABLE `crouton_redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`fromPath` text NOT NULL,
	`toPath` text NOT NULL,
	`statusCode` text NOT NULL,
	`isActive` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crouton_redirects_team_from_path_idx` ON `crouton_redirects` (`teamId`,`fromPath`);--> statement-breakpoint
CREATE TABLE `domain` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`domain` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`verificationToken` text NOT NULL,
	`verifiedAt` integer,
	`isPrimary` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_domain_unique` ON `domain` (`domain`);--> statement-breakpoint
CREATE INDEX `domain_org_idx` ON `domain` (`organizationId`);--> statement-breakpoint
CREATE INDEX `domain_domain_idx` ON `domain` (`domain`);--> statement-breakpoint
CREATE INDEX `domain_status_idx` ON `domain` (`status`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`inviterId` text NOT NULL,
	`organizationId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`teamId` text,
	FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `invitation_org_idx` ON `invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX `invitation_status_idx` ON `invitation` (`status`);--> statement-breakpoint
CREATE TABLE `layout_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`renderer` text NOT NULL,
	`tree` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `layout_configs_team_idx` ON `layout_configs` (`teamId`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`organizationId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_user_idx` ON `member` (`userId`);--> statement-breakpoint
CREATE INDEX `member_org_idx` ON `member` (`organizationId`);--> statement-breakpoint
CREATE INDEX `member_user_org_idx` ON `member` (`userId`,`organizationId`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`personal` integer DEFAULT false NOT NULL,
	`isDefault` integer DEFAULT false NOT NULL,
	`ownerId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE INDEX `organization_slug_idx` ON `organization` (`slug`);--> statement-breakpoint
CREATE INDEX `organization_owner_idx` ON `organization` (`ownerId`);--> statement-breakpoint
CREATE INDEX `organization_default_idx` ON `organization` (`isDefault`);--> statement-breakpoint
CREATE INDEX `organization_personal_idx` ON `organization` (`personal`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`publicKey` text NOT NULL,
	`userId` text NOT NULL,
	`credentialID` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`deviceType` text NOT NULL,
	`backedUp` integer DEFAULT false NOT NULL,
	`transports` text,
	`createdAt` integer,
	`aaguid` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentialID_unique` ON `passkey` (`credentialID`);--> statement-breakpoint
CREATE INDEX `passkey_user_idx` ON `passkey` (`userId`);--> statement-breakpoint
CREATE INDEX `passkey_credential_idx` ON `passkey` (`credentialID`);--> statement-breakpoint
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
CREATE INDEX `idx_printers_location` ON `printers` (`location_id`);--> statement-breakpoint
CREATE TABLE `sales_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`title` text NOT NULL,
	`displayOrder` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`isReusable` integer,
	`isActive` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_events` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`eventType` text,
	`startDate` integer,
	`endDate` integer,
	`status` text NOT NULL,
	`isCurrent` integer,
	`requiresClient` integer,
	`helperPin` text,
	`currency` text,
	`metadata` text,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_events_team_slug_idx` ON `sales_events` (`teamId`,`slug`);--> statement-breakpoint
CREATE TABLE `sales_eventsettings` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`settingKey` text NOT NULL,
	`settingValue` text,
	`description` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_kdsbumps` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`orderId` text NOT NULL,
	`locationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_orderitems` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`orderId` text NOT NULL,
	`productId` text NOT NULL,
	`quantity` integer NOT NULL,
	`unitPrice` real NOT NULL,
	`totalPrice` real NOT NULL,
	`remarks` text,
	`selectedOptions` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`clientId` text,
	`clientName` text,
	`eventOrderNumber` integer,
	`overallRemarks` text,
	`locationRemarks` text,
	`isPersonnel` integer,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`locationId` text NOT NULL,
	`title` text NOT NULL,
	`ipAddress` text NOT NULL,
	`port` text,
	`status` text,
	`type` text,
	`driver` text,
	`config` text,
	`showPrices` integer,
	`isActive` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_printqueues` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`eventId` text NOT NULL,
	`orderId` text NOT NULL,
	`printerId` text NOT NULL,
	`locationId` text,
	`status` text NOT NULL,
	`printData` text NOT NULL,
	`printMode` text,
	`errorMessage` text,
	`retryCount` text,
	`completedAt` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_products` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`eventId` text NOT NULL,
	`categoryId` text,
	`locationId` text,
	`title` text NOT NULL,
	`description` text,
	`price` real NOT NULL,
	`isActive` integer,
	`requiresRemark` integer,
	`remarkPrompt` text,
	`hasOptions` integer,
	`multipleOptionsAllowed` integer,
	`options` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_sync_outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`order_id` text,
	`team_id` text,
	`event_id` text,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sales_sync_outbox_pending` ON `sales_sync_outbox` (`synced_at`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_sales_sync_outbox_entity` ON `sales_sync_outbox` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sales_sync_status` (
	`id` text PRIMARY KEY NOT NULL,
	`last_contact_at` integer,
	`last_event_at` integer,
	`last_batch_applied` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scopedAccessGrant` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`resourceType` text NOT NULL,
	`resourceId` text NOT NULL,
	`role` text DEFAULT 'guest' NOT NULL,
	`credentialType` text DEFAULT 'pin' NOT NULL,
	`secretHash` text NOT NULL,
	`maxUses` integer,
	`usedCount` integer DEFAULT 0 NOT NULL,
	`failedAttempts` integer DEFAULT 0 NOT NULL,
	`lockedUntil` integer,
	`isActive` integer DEFAULT true NOT NULL,
	`expiresAt` integer,
	`tokenTtl` integer DEFAULT 28800000 NOT NULL,
	`metadata` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scoped_grant_resource_idx` ON `scopedAccessGrant` (`resourceType`,`resourceId`);--> statement-breakpoint
CREATE INDEX `scoped_grant_org_idx` ON `scopedAccessGrant` (`organizationId`);--> statement-breakpoint
CREATE INDEX `scoped_grant_active_idx` ON `scopedAccessGrant` (`isActive`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `scopedAccessToken` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`token` text NOT NULL,
	`resourceType` text NOT NULL,
	`resourceId` text NOT NULL,
	`displayName` text NOT NULL,
	`role` text DEFAULT 'guest' NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`expiresAt` integer NOT NULL,
	`lastActiveAt` integer,
	`metadata` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scopedAccessToken_token_unique` ON `scopedAccessToken` (`token`);--> statement-breakpoint
CREATE INDEX `scoped_access_token_idx` ON `scopedAccessToken` (`token`);--> statement-breakpoint
CREATE INDEX `scoped_access_org_idx` ON `scopedAccessToken` (`organizationId`);--> statement-breakpoint
CREATE INDEX `scoped_access_resource_idx` ON `scopedAccessToken` (`resourceType`,`resourceId`);--> statement-breakpoint
CREATE INDEX `scoped_access_active_idx` ON `scopedAccessToken` (`isActive`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`activeOrganizationId` text,
	`impersonatingFrom` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `session_token_idx` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_active_org_idx` ON `session` (`activeOrganizationId`);--> statement-breakpoint
CREATE INDEX `session_impersonating_idx` ON `session` (`impersonatingFrom`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`referenceId` text NOT NULL,
	`stripeCustomerId` text,
	`stripeSubscriptionId` text,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`periodStart` integer,
	`periodEnd` integer,
	`cancelAtPeriodEnd` integer DEFAULT false,
	`seats` integer,
	`trialStart` integer,
	`trialEnd` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subscription_reference_idx` ON `subscription` (`referenceId`);--> statement-breakpoint
CREATE INDEX `subscription_stripe_idx` ON `subscription` (`stripeSubscriptionId`);--> statement-breakpoint
CREATE INDEX `subscription_status_idx` ON `subscription` (`status`);--> statement-breakpoint
CREATE TABLE `team_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`translations` text,
	`ai_settings` text,
	`theme_settings` text,
	`site_settings` text,
	`email_settings` text,
	`notion_settings` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_settings_team_id_unique` ON `team_settings` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_settings_team_idx` ON `team_settings` (`team_id`);--> statement-breakpoint
CREATE TABLE `translations_ui` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text,
	`namespace` text DEFAULT 'ui' NOT NULL,
	`key_path` text NOT NULL,
	`category` text NOT NULL,
	`values` text NOT NULL,
	`description` text,
	`is_overrideable` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translations_ui_team_id_namespace_key_path_unique` ON `translations_ui` (`team_id`,`namespace`,`key_path`);--> statement-breakpoint
CREATE TABLE `twoFactor` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`secret` text NOT NULL,
	`backupCodes` text,
	`enabled` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_user_idx` ON `twoFactor` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`stripeCustomerId` text,
	`superAdmin` integer DEFAULT false NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`bannedReason` text,
	`bannedUntil` integer,
	`role` text DEFAULT 'user'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `user_stripe_customer_idx` ON `user` (`stripeCustomerId`);--> statement-breakpoint
CREATE INDEX `user_super_admin_idx` ON `user` (`superAdmin`);--> statement-breakpoint
CREATE INDEX `user_banned_idx` ON `user` (`banned`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`locale` text,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_userId_unique` ON `user_profile` (`userId`);--> statement-breakpoint
CREATE INDEX `user_profile_user_idx` ON `user_profile` (`userId`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);