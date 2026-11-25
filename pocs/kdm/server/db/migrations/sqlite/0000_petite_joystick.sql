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
	`providerId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_email_log_org_idx` ON `auth_email_log` (`organizationId`);--> statement-breakpoint
CREATE INDEX `auth_email_log_type_idx` ON `auth_email_log` (`emailType`);--> statement-breakpoint
CREATE INDEX `auth_email_log_status_idx` ON `auth_email_log` (`status`);--> statement-breakpoint
CREATE INDEX `auth_email_log_recipient_idx` ON `auth_email_log` (`recipientEmail`);--> statement-breakpoint
CREATE INDEX `auth_email_log_provider_idx` ON `auth_email_log` (`providerId`);--> statement-breakpoint
CREATE INDEX `auth_email_log_created_idx` ON `auth_email_log` (`createdAt`);--> statement-breakpoint
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
CREATE INDEX `domain_org_idx` ON `domain` (`organizationId`);--> statement-breakpoint
CREATE INDEX `domain_domain_idx` ON `domain` (`domain`);--> statement-breakpoint
CREATE INDEX `domain_status_idx` ON `domain` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_org_domain_uniq` ON `domain` (`organizationId`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_verified_uniq` ON `domain` (`domain`) WHERE "domain"."status" = 'verified';--> statement-breakpoint
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
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`publicKey` text NOT NULL,
	`privateKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
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
CREATE TABLE `oauthAccessToken` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text,
	`referenceId` text,
	`authorizationCodeId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`refreshId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refreshId`) REFERENCES `oauthRefreshToken`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthAccessToken_token_unique` ON `oauthAccessToken` (`token`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_idx` ON `oauthAccessToken` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_session_idx` ON `oauthAccessToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_idx` ON `oauthAccessToken` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_code_idx` ON `oauthAccessToken` (`authorizationCodeId`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_refresh_idx` ON `oauthAccessToken` (`refreshId`);--> statement-breakpoint
CREATE TABLE `oauthClient` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`clientSecret` text,
	`clientDiscoveryId` text,
	`disabled` integer DEFAULT false,
	`skipConsent` integer,
	`enableEndSession` integer,
	`subjectType` text,
	`scopes` text,
	`clientCredentialsScopes` text,
	`userId` text,
	`createdAt` integer,
	`updatedAt` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`softwareId` text,
	`softwareVersion` text,
	`softwareStatement` text,
	`redirectUris` text NOT NULL,
	`postLogoutRedirectUris` text,
	`backchannelLogoutUri` text,
	`backchannelLogoutSessionRequired` integer,
	`tokenEndpointAuthMethod` text,
	`applicationType` text,
	`jwks` text,
	`jwksUri` text,
	`grantTypes` text,
	`responseTypes` text,
	`requirePKCE` integer,
	`dpopBoundAccessTokens` integer DEFAULT false,
	`referenceId` text,
	`metadata` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthClient_clientId_unique` ON `oauthClient` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_client_user_idx` ON `oauthClient` (`userId`);--> statement-breakpoint
CREATE TABLE `oauthClientAssertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauthClientResource` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`resourceId` text NOT NULL,
	`metadata` text,
	`createdAt` integer,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resourceId`) REFERENCES `oauthResource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_client_resource_unique_idx` ON `oauthClientResource` (`clientId`,`resourceId`);--> statement-breakpoint
CREATE INDEX `oauth_client_resource_resource_idx` ON `oauthClientResource` (`resourceId`);--> statement-breakpoint
CREATE TABLE `oauthConsent` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`userId` text,
	`referenceId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`scopes` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_client_idx` ON `oauthConsent` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_consent_user_idx` ON `oauthConsent` (`userId`);--> statement-breakpoint
CREATE TABLE `oauthRefreshToken` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text NOT NULL,
	`referenceId` text,
	`authorizationCodeId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`revoked` integer,
	`rotatedAt` integer,
	`rotationReplayResponse` text,
	`rotationReplayExpiresAt` integer,
	`authTime` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthRefreshToken_token_unique` ON `oauthRefreshToken` (`token`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_client_idx` ON `oauthRefreshToken` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_session_idx` ON `oauthRefreshToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_user_idx` ON `oauthRefreshToken` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_code_idx` ON `oauthRefreshToken` (`authorizationCodeId`);--> statement-breakpoint
CREATE TABLE `oauthResource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`accessTokenTtl` integer,
	`refreshTokenTtl` integer,
	`signingAlgorithm` text,
	`signingKeyId` text,
	`allowedScopes` text,
	`customClaims` text,
	`dpopBoundAccessTokensRequired` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`createdAt` integer,
	`updatedAt` integer,
	`policyVersion` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthResource_identifier_unique` ON `oauthResource` (`identifier`);--> statement-breakpoint
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
CREATE TABLE `organizationRole` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`role` text NOT NULL,
	`permission` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`removedActions` text,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organizationRole_organizationId_idx` ON `organizationRole` (`organizationId`);--> statement-breakpoint
CREATE INDEX `organizationRole_role_idx` ON `organizationRole` (`role`);--> statement-breakpoint
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
CREATE TABLE `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`lastRequest` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rateLimit_key_unique` ON `rateLimit` (`key`);--> statement-breakpoint
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
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
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
CREATE TABLE `pages_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`parentId` text,
	`path` text NOT NULL,
	`depth` integer NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`pageType` text NOT NULL,
	`content` text,
	`config` text,
	`status` text NOT NULL,
	`visibility` text NOT NULL,
	`publishedAt` integer,
	`showInNavigation` integer,
	`layout` text,
	`seoTitle` text,
	`seoDescription` text,
	`ogImage` text,
	`robots` text,
	`translations` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_pages_team_slug_idx` ON `pages_pages` (`teamId`,`slug`);--> statement-breakpoint
CREATE TABLE `crouton_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`owner` text NOT NULL,
	`order` integer NOT NULL,
	`userId` text NOT NULL,
	`filename` text NOT NULL,
	`pathname` text NOT NULL,
	`contentType` text,
	`size` integer,
	`category` text,
	`width` integer,
	`height` integer,
	`alt` text,
	`uploadedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `layout_configs` (
	`id` text NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`renderer` text NOT NULL,
	`tree` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`teamId`, `id`)
);
--> statement-breakpoint
CREATE INDEX `layout_configs_team_idx` ON `layout_configs` (`teamId`);