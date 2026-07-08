/**
 * Better Auth Database Schema for Drizzle
 *
 * This schema defines all tables required by Better Auth and its plugins:
 * - Core: user, session, account, verification
 * - Organization Plugin: organization, member, invitation
 * - Passkey Plugin: passkey
 * - Two-Factor Plugin: twoFactor
 * - Stripe Plugin: subscription
 *
 * @see https://www.better-auth.com/docs/concepts/database
 * @see https://www.better-auth.com/docs/adapters/drizzle
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { user } from './user'
import { userProfile } from './user-profile'

// Re-export the user + user-profile schemas so they're included in the built
// auth schema artifact (the user table lives in ./user so user-profile can
// reference it without a circular import through this file)
export { user } from './user'
export type { User, NewUser } from './user'
export { userProfile, userProfileRelations } from './user-profile'
export type { UserProfileRecord, NewUserProfileRecord } from './user-profile'

// ============================================================================
// Core Tables
// ============================================================================

/**
 * Session table - User sessions
 *
 * Tracks active user sessions with expiration and device info.
 * Extended with activeOrganizationId for organization context.
 */
export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  // Organization extension - tracks active team context
  activeOrganizationId: text('activeOrganizationId'),
  // Impersonation extension (crouton-admin package)
  /** The original admin user ID when impersonating */
  impersonatingFrom: text('impersonatingFrom')
}, table => [
  index('session_user_idx').on(table.userId),
  index('session_token_idx').on(table.token),
  index('session_active_org_idx').on(table.activeOrganizationId),
  index('session_impersonating_idx').on(table.impersonatingFrom)
])

/**
 * Account table - OAuth and credential accounts
 *
 * Links external OAuth providers and stores credential (password) auth.
 * A user can have multiple accounts (e.g., Google + GitHub + password).
 */
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('idToken'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('account_user_idx').on(table.userId),
  index('account_provider_idx').on(table.providerId, table.accountId)
])

/**
 * Verification table - Email and other verifications
 *
 * Stores verification tokens for email verification, password reset, etc.
 */
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('verification_identifier_idx').on(table.identifier)
])

// ============================================================================
// Organization Plugin Tables
// ============================================================================

/**
 * Organization table - Teams/workspaces
 *
 * Stores organization (team) data. Configuration flags control behavior:
 * - teams.allowCreate=true: Users can create multiple organizations
 * - teams.defaultTeamSlug: All users join this org on signup (isDefault = true)
 * - teams.autoCreateOnSignup: Auto-create personal workspace (personal = true)
 */
export const organization = sqliteTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'), // JSON string for additional data

  // Organization type flags
  /** True if this is a personal workspace (autoCreateOnSignup config) */
  personal: integer('personal', { mode: 'boolean' }).notNull().default(false),
  /** True if this is the default organization (defaultTeamSlug config) */
  isDefault: integer('isDefault', { mode: 'boolean' }).notNull().default(false),
  /** Owner user ID for personal workspaces */
  ownerId: text('ownerId'),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date())
}, table => [
  index('organization_slug_idx').on(table.slug),
  // Index for finding personal workspaces by owner
  index('organization_owner_idx').on(table.ownerId),
  // Index for finding the default organization (defaultTeamSlug config)
  index('organization_default_idx').on(table.isDefault),
  // Index for filtering personal workspaces (autoCreateOnSignup config)
  index('organization_personal_idx').on(table.personal)
])

/**
 * Member table - Organization membership
 *
 * Links users to organizations with roles (owner, admin, member).
 */
export const member = sqliteTable('member', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date())
}, table => [
  index('member_user_idx').on(table.userId),
  index('member_org_idx').on(table.organizationId),
  index('member_user_org_idx').on(table.userId, table.organizationId)
])

/**
 * Invitation table - Pending organization invitations
 *
 * Manages invitations to join organizations.
 */
export const invitation = sqliteTable('invitation', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  inviterId: text('inviterId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  status: text('status').notNull().default('pending'), // pending, accepted, rejected, expired
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  teamId: text('teamId') // Optional sub-team reference
}, table => [
  index('invitation_email_idx').on(table.email),
  index('invitation_org_idx').on(table.organizationId),
  index('invitation_status_idx').on(table.status)
])

// ============================================================================
// Passkey Plugin Table
// ============================================================================

/**
 * Passkey table - WebAuthn credentials
 *
 * Stores passkey/FIDO2 credentials for passwordless authentication.
 */
export const passkey = sqliteTable('passkey', {
  id: text('id').primaryKey(),
  name: text('name'),
  publicKey: text('publicKey').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  credentialID: text('credentialID').notNull().unique(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('deviceType').notNull(),
  backedUp: integer('backedUp', { mode: 'boolean' }).notNull().default(false),
  transports: text('transports'), // JSON array of transport types
  createdAt: integer('createdAt', { mode: 'timestamp' }).$default(() => new Date()),
  aaguid: text('aaguid') // Authenticator GUID
}, table => [
  index('passkey_user_idx').on(table.userId),
  index('passkey_credential_idx').on(table.credentialID)
])

// ============================================================================
// Two-Factor Plugin Table
// ============================================================================

/**
 * Two-Factor table - 2FA configuration
 *
 * Stores TOTP secrets and backup codes for two-factor authentication.
 */
export const twoFactor = sqliteTable('twoFactor', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backupCodes'), // JSON array of { code, used } objects
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('two_factor_user_idx').on(table.userId)
])

// ============================================================================
// Stripe Plugin Table
// ============================================================================

/**
 * Subscription table - Stripe subscriptions
 *
 * Tracks subscription status for billing.
 * referenceId can be either userId (personal mode) or organizationId (team billing).
 */
export const subscription = sqliteTable('subscription', {
  id: text('id').primaryKey(),
  plan: text('plan').notNull(),
  referenceId: text('referenceId').notNull(), // userId or organizationId
  stripeCustomerId: text('stripeCustomerId'),
  stripeSubscriptionId: text('stripeSubscriptionId'),
  status: text('status').notNull().default('incomplete'),
  periodStart: integer('periodStart', { mode: 'timestamp' }),
  periodEnd: integer('periodEnd', { mode: 'timestamp' }),
  cancelAtPeriodEnd: integer('cancelAtPeriodEnd', { mode: 'boolean' }).default(false),
  seats: integer('seats'),
  trialStart: integer('trialStart', { mode: 'timestamp' }),
  trialEnd: integer('trialEnd', { mode: 'timestamp' }),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('subscription_reference_idx').on(table.referenceId),
  index('subscription_stripe_idx').on(table.stripeSubscriptionId),
  index('subscription_status_idx').on(table.status)
])

// ============================================================================
// Custom Domains Table
// ============================================================================

/**
 * Domain table - Custom domains for organizations
 *
 * Allows organizations to configure custom domains with DNS verification.
 * Supports multiple domains per organization with one primary domain.
 */
export const domain = sqliteTable('domain', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(),
  status: text('status').notNull().default('pending'), // 'pending', 'verified', 'failed'
  verificationToken: text('verificationToken').notNull(),
  verifiedAt: integer('verifiedAt', { mode: 'timestamp' }),
  isPrimary: integer('isPrimary', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('domain_org_idx').on(table.organizationId),
  index('domain_domain_idx').on(table.domain),
  index('domain_status_idx').on(table.status)
])

// ============================================================================
// Scoped Access Token Table
// ============================================================================

/**
 * Scoped Access Token table - Resource-scoped authentication
 *
 * Provides lightweight, temporary authentication for resource-specific access.
 * Used for scenarios where a full user account isn't needed:
 * - Event helpers (POS/sales)
 * - Guest access to bookings
 * - Temporary attendee access
 *
 * Unlike Better Auth sessions, these tokens:
 * - Don't require a user account
 * - Are scoped to a specific resource (event, booking, etc.)
 * - Support PIN-based authentication (PIN managed by consuming package)
 * - Have configurable expiration
 */
export const scopedAccessToken = sqliteTable('scopedAccessToken', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Organization/team the token belongs to */
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Unique token string for authentication */
  token: text('token').notNull().unique(),
  /** Type of resource this token is scoped to (e.g., 'event', 'booking') */
  resourceType: text('resourceType').notNull(),
  /** ID of the specific resource */
  resourceId: text('resourceId').notNull(),
  /** Display name for the token holder (e.g., helper name, guest name) */
  displayName: text('displayName').notNull(),
  /** Role for authorization (e.g., 'helper', 'attendee', 'guest') */
  role: text('role').notNull().default('guest'),
  /** Whether this token is currently active */
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  /** When this token expires */
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  /** Last activity timestamp */
  lastActiveAt: integer('lastActiveAt', { mode: 'timestamp' }),
  /** Additional metadata (JSON) */
  metadata: text('metadata'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('scoped_access_token_idx').on(table.token),
  index('scoped_access_org_idx').on(table.organizationId),
  index('scoped_access_resource_idx').on(table.resourceType, table.resourceId),
  index('scoped_access_active_idx').on(table.isActive, table.expiresAt)
])

// ============================================================================
// Scoped Access Grant Table
// ============================================================================

/**
 * Scoped Access Grant table - Redeemable credentials for scoped tokens
 *
 * A grant is the credential half of scoped access: "present this secret for
 * this resource, receive a scopedAccessToken." One shared event PIN is one
 * grant with unlimited uses; an invite code is a grant with maxUses: 1.
 *
 * Domains own the binding (which resource gets a grant, what role its tokens
 * carry); this table owns verification, redemption limits, and brute-force
 * lockout. Grants are not accounts — no email, no identity, no lifecycle
 * beyond expiry.
 */
export const scopedAccessGrant = sqliteTable('scopedAccessGrant', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Organization/team the grant belongs to */
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Type of resource this grant unlocks (e.g., 'event', 'page', 'booking') */
  resourceType: text('resourceType').notNull(),
  /** ID of the specific resource */
  resourceId: text('resourceId').notNull(),
  /** Role stamped onto tokens minted from this grant (e.g., 'helper', 'guest') */
  role: text('role').notNull().default('guest'),
  /** How the secret is presented: 'pin' (typed) — 'link' (URL-embedded) reserved */
  credentialType: text('credentialType').notNull().default('pin'),
  /** Salted hash of the secret, formatted as `{saltHex}:{sha256Hex}` */
  secretHash: text('secretHash').notNull(),
  /** Max successful redemptions; null = unlimited (shared PIN) */
  maxUses: integer('maxUses'),
  /** Successful redemptions so far */
  usedCount: integer('usedCount').notNull().default(0),
  /** Consecutive failed secret attempts (reset on success) */
  failedAttempts: integer('failedAttempts').notNull().default(0),
  /** Brute-force lockout: redemption refused until this passes */
  lockedUntil: integer('lockedUntil', { mode: 'timestamp' }),
  /** Whether this grant can currently be redeemed */
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  /** When the grant stops being redeemable; null = no expiry (follows resource) */
  expiresAt: integer('expiresAt', { mode: 'timestamp' }),
  /** Lifetime (ms) of tokens minted from this grant */
  tokenTtl: integer('tokenTtl').notNull().default(8 * 60 * 60 * 1000),
  /** Additional metadata (JSON) */
  metadata: text('metadata'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('scoped_grant_resource_idx').on(table.resourceType, table.resourceId),
  index('scoped_grant_org_idx').on(table.organizationId),
  index('scoped_grant_active_idx').on(table.isActive, table.expiresAt)
])

// ============================================================================
// Auth Email Log Table
// ============================================================================

/**
 * Auth Email Log table - Tracks all authentication-related emails
 *
 * Logs every email dispatched through the crouton:auth:email hook.
 * Provides admin visibility into verification, password reset,
 * invitation, and magic link emails.
 */
export const authEmailLog = sqliteTable('auth_email_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Organization/team context (null for non-team emails) */
  organizationId: text('organizationId'),
  /** Email type: verification, password-reset, invitation, magic-link */
  emailType: text('emailType').notNull(),
  /** Recipient email address */
  recipientEmail: text('recipientEmail').notNull(),
  /** Delivery status */
  status: text('status').notNull().default('pending'), // pending, sent, failed
  /** Error message if delivery failed */
  error: text('error'),
  /** When the email was actually sent */
  sentAt: integer('sentAt', { mode: 'timestamp' }),
  /** Additional context (e.g., inviter name, team name) */
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, string>>(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date())
}, table => [
  index('auth_email_log_org_idx').on(table.organizationId),
  index('auth_email_log_type_idx').on(table.emailType),
  index('auth_email_log_status_idx').on(table.status),
  index('auth_email_log_recipient_idx').on(table.recipientEmail),
  index('auth_email_log_created_idx').on(table.createdAt)
])

// ============================================================================
// Relations
// ============================================================================

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(member),
  passkeys: many(passkey),
  twoFactors: many(twoFactor),
  invitationsSent: many(invitation),
  profile: one(userProfile, {
    fields: [user.id],
    references: [userProfile.userId],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  }),
  activeOrganization: one(organization, {
    fields: [session.activeOrganizationId],
    references: [organization.id]
  })
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}))

export const organizationRelations = relations(organization, ({ many, one }) => ({
  members: many(member),
  invitations: many(invitation),
  sessions: many(session),
  domains: many(domain),
  settings: one(teamSettings)
}))

export const memberRelations = relations(member, ({ one }) => ({
  user: one(user, {
    fields: [member.userId],
    references: [user.id]
  }),
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id]
  })
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id]
  }),
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id]
  })
}))

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, {
    fields: [passkey.userId],
    references: [user.id]
  })
}))

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id]
  })
}))

export const domainRelations = relations(domain, ({ one }) => ({
  organization: one(organization, {
    fields: [domain.organizationId],
    references: [organization.id]
  })
}))

export const scopedAccessTokenRelations = relations(scopedAccessToken, ({ one }) => ({
  organization: one(organization, {
    fields: [scopedAccessToken.organizationId],
    references: [organization.id]
  })
}))

export const authEmailLogRelations = relations(authEmailLog, ({ one }) => ({
  organization: one(organization, {
    fields: [authEmailLog.organizationId],
    references: [organization.id]
  })
}))

// ============================================================================
// Type Exports
// ============================================================================

export type Session = typeof session.$inferSelect
export type NewSession = typeof session.$inferInsert

export type Account = typeof account.$inferSelect
export type NewAccount = typeof account.$inferInsert

export type Verification = typeof verification.$inferSelect
export type NewVerification = typeof verification.$inferInsert

export type Organization = typeof organization.$inferSelect
export type NewOrganization = typeof organization.$inferInsert

export type Member = typeof member.$inferSelect
export type NewMember = typeof member.$inferInsert

export type Invitation = typeof invitation.$inferSelect
export type NewInvitation = typeof invitation.$inferInsert

export type Passkey = typeof passkey.$inferSelect
export type NewPasskey = typeof passkey.$inferInsert

export type TwoFactor = typeof twoFactor.$inferSelect
export type NewTwoFactor = typeof twoFactor.$inferInsert

export type Subscription = typeof subscription.$inferSelect
export type NewSubscription = typeof subscription.$inferInsert

export type Domain = typeof domain.$inferSelect
export type NewDomain = typeof domain.$inferInsert

export type ScopedAccessToken = typeof scopedAccessToken.$inferSelect
export type NewScopedAccessToken = typeof scopedAccessToken.$inferInsert

export type ScopedAccessGrant = typeof scopedAccessGrant.$inferSelect
export type NewScopedAccessGrant = typeof scopedAccessGrant.$inferInsert

export type AuthEmailLog = typeof authEmailLog.$inferSelect
export type NewAuthEmailLog = typeof authEmailLog.$inferInsert

// ============================================================================
// Team Settings Table
// ============================================================================

/**
 * AI settings type for team-specific API keys and preferences
 * Keys are stored server-side only - never exposed to client
 */
export interface TeamAISettings {
  /** Anthropic API key (e.g., sk-ant-...) */
  anthropicApiKey?: string
  /** OpenAI API key (e.g., sk-...) */
  openaiApiKey?: string
  /** Default AI model for this team (e.g., claude-sonnet-4-20250514, gpt-4o) */
  defaultModel?: string
  /** Default AI provider: 'anthropic' | 'openai' */
  defaultProvider?: 'anthropic' | 'openai'
}

/**
 * Theme color options (Tailwind CSS colors)
 */
export type ThemePrimaryColor =
  | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green'
  | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo'
  | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose'

export type ThemeNeutralColor = 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'

export type ThemeRadius = 0 | 0.125 | 0.25 | 0.375 | 0.5

/** Named theme presets */
export type ThemePreset = 'custom' | 'blackandwhite' | 'ko'

/**
 * Site settings for public site configuration
 */
export interface TeamSiteSettings {
  /** Whether the team's public site is enabled. Defaults to true when not set. */
  publicSiteEnabled?: boolean
  /** Blob pathname for custom team favicon (e.g. "team-123/favicon.png") */
  favicon?: string
  /** Contact email address */
  contactEmail?: string
  /** Newsletter signup URL */
  newsletterUrl?: string
  /** Calendar/schedule URL (e.g. iCal, Google Calendar) */
  calendarUrl?: string
  /** Registration/enrollment URL */
  registrationUrl?: string
  /** Social media links */
  socialLinks?: {
    facebook?: string
    instagram?: string
    youtube?: string
    linkedin?: string
    twitter?: string
    tiktok?: string
  }
}

/**
 * Email template content overrides per email type.
 * Admins can customize the copy in auth emails sent to their team's users.
 * All fields are optional — omitted fields fall back to the template defaults.
 */
export type EmailTemplateType = 'password-reset' | 'verification' | 'magic-link' | 'team-invite' | 'welcome'

export interface EmailTemplateOverrides {
  /** Email subject line. Supports {{brandName}}, {{teamName}} placeholders. */
  subject?: string
  /** Greeting text (e.g. "Hi {{name}}"). Supports {{name}} placeholder. */
  greeting?: string
  /** Main body text. Supports {{brandName}}, {{name}}, {{teamName}}, {{inviterName}}, {{role}} depending on type. */
  body?: string
  /** CTA button label (e.g. "Reset password") */
  buttonText?: string
  /** Footer/disclaimer text. Supports {{minutes}} for expiry-based emails. */
  footer?: string
}

export type TeamEmailSettings = {
  [K in EmailTemplateType]?: EmailTemplateOverrides
}

/**
 * Notion integration settings for two-way task sync
 * Used by ThinkGraph to create/update Notion pages when node status changes
 */
export interface TeamNotionSettings {
  /** Notion internal integration token (secret_...) */
  integrationToken?: string
  /** Masked hint of the token for display (e.g. "secret_...abc") */
  integrationTokenHint?: string
  /** Notion database ID to create task pages in */
  taskDatabaseId?: string
  /** Mapping from ThinkGraph node statuses to Notion Status property values */
  statusMapping?: {
    idle?: string      // e.g. "To Do"
    working?: string   // e.g. "In Progress"
    done?: string      // e.g. "Done"
  }
}

/**
 * Theme settings for team visual customization
 * Similar to Nuxt UI's theme picker
 */
export interface TeamThemeSettings {
  /** Named preset — when set, overrides individual color/variant settings */
  preset?: ThemePreset
  /** Primary color for buttons, links, and accents */
  primary?: ThemePrimaryColor
  /** Neutral color for backgrounds, borders, and text */
  neutral?: ThemeNeutralColor
  /** Border radius in rem (0 = sharp corners, 0.5 = fully rounded) */
  radius?: ThemeRadius
  /** Whether non-admin users can switch themes. Defaults to true when not set. */
  allowUserThemes?: boolean
}

/**
 * Team settings table for translation overrides, AI configuration, and theme
 *
 * This table stores team-specific settings that take precedence over system defaults.
 * Includes translation overrides, AI API keys, and visual theme preferences.
 */
export const teamSettings = sqliteTable('team_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('team_id')
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: 'cascade' }),
  /** Team-specific translation overrides by locale */
  translations: text('translations', { mode: 'json' }).$type<{
    [locale: string]: {
      [key: string]: string
    }
  }>(),
  /**
   * AI settings including API keys and preferences
   * SECURITY: This field is server-side only - never expose to client
   */
  aiSettings: text('ai_settings', { mode: 'json' }).$type<TeamAISettings>(),
  /**
   * Theme settings for team visual customization
   * Safe to expose to client - no sensitive data
   */
  themeSettings: text('theme_settings', { mode: 'json' }).$type<TeamThemeSettings>(),
  /**
   * Site settings for public site configuration
   * Safe to expose to client - no sensitive data
   */
  siteSettings: text('site_settings', { mode: 'json' }).$type<TeamSiteSettings>(),
  /**
   * Email template content overrides per email type
   * Safe to expose to client - no sensitive data, just copy/labels
   */
  emailSettings: text('email_settings', { mode: 'json' }).$type<TeamEmailSettings>(),
  /**
   * Notion integration settings for two-way task sync
   * SECURITY: Contains integration token - never expose raw token to client
   */
  notionSettings: text('notion_settings', { mode: 'json' }).$type<TeamNotionSettings>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$default(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$onUpdate(() => new Date())
}, table => [
  index('team_settings_team_idx').on(table.teamId)
])

export const teamSettingsRelations = relations(teamSettings, ({ one }) => ({
  organization: one(organization, {
    fields: [teamSettings.teamId],
    references: [organization.id]
  })
}))

export type TeamSettings = typeof teamSettings.$inferSelect
export type NewTeamSettings = typeof teamSettings.$inferInsert
