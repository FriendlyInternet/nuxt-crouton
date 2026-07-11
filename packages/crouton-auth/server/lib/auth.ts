/// <reference path="../crouton-hooks.d.ts" />
/**
 * Better Auth Instance Factory
 *
 * Creates and configures a Better Auth instance based on @crouton/auth configuration.
 * Supports SQLite (NuxtHub D1) with Drizzle adapter.
 *
 * @example
 * ```typescript
 * // In a Nitro plugin
 * import { createAuth } from '../lib/auth'
 *
 * const auth = createAuth(config, db)
 * ```
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization, twoFactor, magicLink, admin, haveIBeenPwned, type TwoFactorOptions } from 'better-auth/plugins'
import { i18n } from '@better-auth/i18n'
import { passkey } from '@better-auth/passkey'
import { sql } from 'drizzle-orm'
import { useNitroApp } from 'nitropack/runtime'
import type { BetterAuthOptions } from 'better-auth'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type {
  CroutonAuthConfig,
  SessionConfig,
  PasswordConfig,
  PasskeyConfig,
  TwoFactorConfig,
  OAuthConfig,
  GitHubOAuthConfig,
  GoogleOAuthConfig,
  DiscordOAuthConfig,
  OAuthProviderConfig
} from '../../types/config'

// Re-export type helpers for use in this module
export { isMethodEnabled, getMethodConfig } from '../../types/config'

// Type declarations for browser APIs used in WebAuthn helper functions
// These helpers are intended for client-side use only
declare const window: Window | undefined
declare const PublicKeyCredential: {
  isConditionalMediationAvailable?: () => Promise<boolean>
} | undefined
interface WebAuthnNavigator {
  credentials?: unknown
}
declare const navigator: WebAuthnNavigator | undefined

/**
 * Database provider type
 */
export type DatabaseProvider = 'sqlite' | 'pg' | 'mysql'

/**
 * Options for creating the auth instance
 */
export interface CreateAuthOptions {
  /** @crouton/auth configuration */
  config: CroutonAuthConfig
  /** Drizzle database instance */
  db: DrizzleD1Database<Record<string, unknown>>
  /** Database provider (default: 'sqlite') */
  provider?: DatabaseProvider
  /** Better Auth secret for session encryption */
  secret: string
  /** Application base URL */
  baseURL: string
  /** Optional Drizzle schema for custom table names */
  schema?: Record<string, unknown>
}

/**
 * Create a Better Auth instance configured for @crouton/auth
 *
 * This factory function creates a Better Auth instance with:
 * - Drizzle adapter for database operations
 * - Session configuration from @crouton/auth config
 * - Email/password authentication (configurable)
 * - Base configuration that can be extended with plugins
 *
 * @param options - Configuration options
 * @returns Configured Better Auth instance
 */
export function createAuth(options: CreateAuthOptions) {
  const {
    config,
    db,
    provider = 'sqlite',
    secret,
    baseURL,
    schema
  } = options

  // Build Better Auth configuration
  const authConfig: BetterAuthOptions = {
    // Database adapter
    database: drizzleAdapter(db, {
      provider,
      ...(schema && { schema })
    }),

    // Base URL for callbacks
    baseURL,

    // Secret for session encryption
    secret,

    // Email and password configuration
    emailAndPassword: buildEmailPasswordConfig(config),

    // Email verification (required for changeEmail)
    emailVerification: {
      sendVerificationEmail: async ({ user, url }: { user: { email: string, name?: string }, url: string }) => {
        if (config.debug) {
          console.log(`[crouton/auth] Verification email for ${user.email}: ${url}`)
        }
        let _event: any; try { _event = useEvent() } catch {}
        await useNitroApp().hooks.callHook('crouton:auth:email', {
          _event,
          type: 'verification',
          to: user.email,
          url,
          userName: user.name
        }).catch(() => {})
      },
      sendOnSignUp: false
    },

    // User configuration (changeEmail)
    user: buildUserConfig(config),

    // OAuth/Social providers configuration
    socialProviders: buildSocialProvidersConfig(config.methods?.oauth, baseURL),

    // Session configuration
    session: buildSessionConfig(config.session),

    // Advanced options
    advanced: {
      // Generate secure IDs - moved to database config in Better Auth 1.4.x
      database: {
        generateId: () => crypto.randomUUID()
      }
    },

    // Trusted origins for CORS/CSRF protection.
    // Passed as a function so the static list (baseURL origin, dev localhost,
    // BETTER_AUTH_TRUSTED_ORIGINS) is always joined by the origin the request
    // was actually served from. A browser login is same-origin, so it works on
    // any host the app runs on — the custom domain (kassa.friendlyinter.net),
    // *.pages.dev preview URLs, the kassa.local venue host — with no dependency
    // on BETTER_AUTH_URL / a dashboard env var being set, and without the cached
    // auth instance locking the list to whichever host initialized it first.
    // Still CSRF-safe: a cross-site attack carries a foreign Origin header that
    // won't match the request's own host (same guarantee as Better Auth's own
    // request-derived baseURL trust).
    trustedOrigins: (request?: Request) => {
      const origins = buildTrustedOrigins(baseURL)
      if (request) {
        try {
          origins.push(new URL(request.url).origin)
        } catch {
          // Malformed request URL — fall back to the static list.
        }
      }
      return origins
    },

    // Plugins - Organization (Teams), Passkey, and 2FA support
    plugins: buildPlugins(config, baseURL, config.debug, db),

    // Database hooks for single-tenant mode (auto-add users to default org)
    databaseHooks: buildDatabaseHooks(config, db)
  }

  // Create and return the Better Auth instance
  return betterAuth(authConfig)
}

/**
 * Build email/password configuration from @crouton/auth config
 */
function buildEmailPasswordConfig(config: CroutonAuthConfig): BetterAuthOptions['emailAndPassword'] {
  const passwordConfig = config.methods?.password

  // Check if password auth is enabled
  if (passwordConfig === false) {
    return { enabled: false }
  }

  // Default to enabled
  if (passwordConfig === undefined || passwordConfig === true) {
    return {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }: { user: { email: string, name?: string }, url: string }) => {
        if (config.debug) {
          console.log(`[crouton/auth] Password reset email for ${user.email}: ${url}`)
        }
        let _event: any; try { _event = useEvent() } catch {}
        await useNitroApp().hooks.callHook('crouton:auth:email', {
          _event,
          type: 'password-reset',
          to: user.email,
          url,
          userName: user.name
        }).catch(() => {})
      }
    }
  }

  // Custom password configuration
  const customConfig = passwordConfig as PasswordConfig
  return {
    enabled: customConfig.enabled !== false,
    autoSignIn: true,
    minPasswordLength: customConfig.minLength ?? 8,
    // Password reset
    sendResetPassword: customConfig.resetEnabled !== false
      ? async ({ user, url }: { user: { email: string, name?: string }, url: string }) => {
        if (config.debug) {
          console.log(`[crouton/auth] Password reset email for ${user.email}: ${url}`)
        }
        let _event: any; try { _event = useEvent() } catch {}
        await useNitroApp().hooks.callHook('crouton:auth:email', {
          _event,
          type: 'password-reset',
          to: user.email,
          url,
          userName: user.name
        }).catch(() => {})
      }
      : undefined
  }
}

/**
 * Build user configuration including changeEmail support
 */
function buildUserConfig(_config: CroutonAuthConfig): BetterAuthOptions['user'] {
  return {
    changeEmail: {
      enabled: true
    },
    additionalFields: {
      superAdmin: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false
      },
      banned: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false
      },
      bannedReason: {
        type: 'string',
        required: false,
        input: false
      },
      bannedUntil: {
        type: 'date',
        required: false,
        input: false
      }
    }
  }
}

/**
 * Build trusted origins for CORS/CSRF protection
 *
 * Better Auth validates the Origin header against trusted origins.
 * This function generates the list based on the baseURL and
 * includes localhost variants for development.
 *
 * @param baseURL - Application base URL
 * @returns Array of trusted origin URLs
 */
function buildTrustedOrigins(baseURL: string): string[] {
  const origins: Set<string> = new Set()

  // Add the configured baseURL origin
  try {
    const url = new URL(baseURL)
    origins.add(url.origin)

    // For Cloudflare Pages, add wildcard to cover preview deployment URLs
    // e.g., https://bike-sheds.pages.dev → https://*.bike-sheds.pages.dev
    if (url.hostname.endsWith('.pages.dev')) {
      origins.add(`https://*.${url.hostname}`)
    }
  } catch {
    // If baseURL is invalid, just add it as-is
    origins.add(baseURL)
  }

  // In development, add common localhost variants
  if (process.env.NODE_ENV !== 'production') {
    // Add localhost with development ports (3000-3020 for dynamic port assignment)
    for (let port = 3000; port <= 3020; port++) {
      origins.add(`http://localhost:${port}`)
      origins.add(`http://127.0.0.1:${port}`)
    }
    // Also add other common dev ports
    for (const port of ['4000', '5000', '8080']) {
      origins.add(`http://localhost:${port}`)
      origins.add(`http://127.0.0.1:${port}`)
    }

    // Add local network IPs for Pi worker / device testing
    for (let port = 3000; port <= 3010; port++) {
      origins.add(`http://192.168.0.157:${port}`)
    }
  }

  // Add custom trusted origins from env (comma-separated). Applies in
  // production too — required when a custom domain fronts a Pages project
  // (e.g. kassa.friendlyinter.net alongside fanfare.pages.dev): the
  // baseURL-derived origin only covers the host the auth instance was
  // created with.
  const extraOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  if (extraOrigins) {
    for (const origin of extraOrigins.split(',')) {
      origins.add(origin.trim())
    }
  }

  return Array.from(origins)
}

/**
 * Build session configuration from @crouton/auth config
 */
function buildSessionConfig(sessionConfig?: SessionConfig): BetterAuthOptions['session'] {
  const defaults = {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 // 5 minutes
    }
  }

  if (!sessionConfig) {
    return defaults
  }

  return {
    expiresIn: sessionConfig.expiresIn ?? defaults.expiresIn,
    updateAge: sessionConfig.updateAge ?? defaults.updateAge,
    cookieCache: defaults.cookieCache
  }
}

// ============================================================================
// Database Hooks for Automatic Team Creation
// ============================================================================

/**
 * Build database hooks for automatic team creation
 *
 * These hooks automatically:
 *
 * **defaultTeamSlug (company app pattern):**
 * 1. Create the default organization on first user signup (lazy creation)
 * 2. Add new users to the default organization
 * 3. Set the default organization as active for new sessions
 *
 * **autoCreateOnSignup (personal workspace pattern):**
 * 1. Create a personal organization for each new user on signup
 * 2. Make the user the owner of their personal organization
 * 3. Set the personal organization as active for new sessions
 *
 * @param config - @crouton/auth configuration
 * @param db - Drizzle database instance
 * @returns Database hooks configuration or undefined if no auto-creation enabled
 */
function buildDatabaseHooks(
  config: CroutonAuthConfig,
  db: DrizzleD1Database<Record<string, unknown>>
): BetterAuthOptions['databaseHooks'] {
  const teams = config.teams ?? {}
  const hasDefaultTeam = !!teams.defaultTeamSlug
  const hasAutoCreate = !!teams.autoCreateOnSignup

  // No hooks needed if neither auto-creation feature is enabled
  if (!hasDefaultTeam && !hasAutoCreate) {
    return undefined
  }

  const appName = config.appName ?? 'Default Workspace'

  return {
    user: {
      create: {
        after: async (user) => {
          // Emit operation event for new user registration
          useNitroApp().hooks.callHook('crouton:operation', {
            type: 'auth:user:registered',
            source: 'crouton-auth',
            userId: user.id,
            metadata: { email: user.email },
            timestamp: Date.now()
          }).catch(() => {})

          // Handle default team (company app pattern)
          if (hasDefaultTeam) {
            const defaultTeamSlug = teams.defaultTeamSlug!
            // 1. Ensure default org exists (lazy creation)
            await ensureDefaultOrgExists(db, defaultTeamSlug, appName)

            // 2. Add user to default org as member
            await addUserToDefaultOrg(db, user.id, defaultTeamSlug)

            if (config.debug) {
              console.log(`[crouton/auth] User ${user.email} added to default org (slug: ${defaultTeamSlug})`)
            }
          }

          // Handle auto-create personal workspace
          if (hasAutoCreate) {
            const orgId = await createPersonalOrg(db, user.id, user.name, user.email, config.appName)

            if (config.debug) {
              console.log(`[crouton/auth] Personal org ${orgId} created for user ${user.email}`)
            }
          }
        }
      }
    },
    session: {
      create: {
        after: async (session) => {
          // Priority: personal workspace > default team
          // This ensures users land in their own workspace first if both are enabled
          if (hasAutoCreate) {
            const personalOrgId = await getUserPersonalOrgId(db, session.userId)
            if (personalOrgId) {
              await setSessionActiveOrg(db, session.id, personalOrgId)

              if (config.debug) {
                console.log(`[crouton/auth] Session ${session.id} set to personal org ${personalOrgId}`)
              }
              return
            } else if (config.debug) {
              console.warn(`[crouton/auth] No personal org found for user ${session.userId}`)
            }
          }

          // Fall back to default team
          if (hasDefaultTeam) {
            // Get the org ID by slug
            const defaultOrg = await getOrgBySlug(db, teams.defaultTeamSlug!)
            if (defaultOrg) {
              await setSessionActiveOrg(db, session.id, defaultOrg.id)

              if (config.debug) {
                console.log(`[crouton/auth] Session ${session.id} set to default org (slug: ${teams.defaultTeamSlug})`)
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Get organization by slug
 *
 * @param db - Drizzle database instance
 * @param slug - Organization slug to find
 * @returns Organization object or null if not found
 */
async function getOrgBySlug(
  db: DrizzleD1Database<Record<string, unknown>>,
  slug: string
): Promise<{ id: string, name: string, slug: string } | null> {
  const result = await db.all(sql`
    SELECT id, name, slug FROM organization WHERE slug = ${slug}
  `)

  if (result.length === 0) {
    return null
  }

  return result[0] as { id: string, name: string, slug: string }
}

/**
 * Ensure the default organization exists (lazy creation)
 *
 * Creates the default organization if it doesn't exist.
 * This is called on first user signup when defaultTeamSlug is set.
 *
 * @param db - Drizzle database instance
 * @param slug - Default team slug from config
 * @param appName - Application name for the default org
 */
async function ensureDefaultOrgExists(
  db: DrizzleD1Database<Record<string, unknown>>,
  slug: string,
  appName: string
): Promise<void> {
  // Check if org exists by slug
  const existing = await getOrgBySlug(db, slug)

  if (!existing) {
    // Create default organization with isDefault flag
    const orgId = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.run(sql`
      INSERT INTO organization (id, name, slug, isDefault, personal, createdAt)
      VALUES (${orgId}, ${appName}, ${slug}, 1, 0, ${now})
    `)
    console.log(`[crouton/auth] Created default organization "${appName}" (slug: ${slug})`)
  }
}

/**
 * Add a user to the default organization
 *
 * Creates a member record for the user in the default organization.
 * Idempotent - checks if membership already exists before inserting.
 *
 * @param db - Drizzle database instance
 * @param userId - User ID to add
 * @param slug - Default team slug from config
 */
async function addUserToDefaultOrg(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  slug: string
): Promise<void> {
  // Get the org by slug
  const org = await getOrgBySlug(db, slug)
  if (!org) {
    console.warn(`[crouton/auth] Cannot add user to default org - org with slug "${slug}" not found`)
    return
  }

  // Check if already a member (idempotent)
  const existing = await db.all(sql`
    SELECT id FROM member WHERE organizationId = ${org.id} AND userId = ${userId}
  `)

  if (existing.length === 0) {
    // First user to join the default org becomes owner; everyone after is member
    const memberCount = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) as count FROM member WHERE organizationId = ${org.id}
    `)
    const isFirstUser = (memberCount[0]?.count ?? 0) === 0
    const role = isFirstUser ? 'owner' : 'member'
    const memberId = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.run(sql`
      INSERT INTO member (id, organizationId, userId, role, createdAt)
      VALUES (${memberId}, ${org.id}, ${userId}, ${role}, ${now})
    `)
  }
}

/**
 * Set the active organization for a session
 *
 * Updates the session record to set the active organization.
 *
 * @param db - Drizzle database instance
 * @param sessionId - Session ID to update
 * @param orgId - Organization ID to set as active
 */
async function setSessionActiveOrg(
  db: DrizzleD1Database<Record<string, unknown>>,
  sessionId: string,
  orgId: string
): Promise<void> {
  await db.run(sql`
    UPDATE session SET activeOrganizationId = ${orgId} WHERE id = ${sessionId}
  `)
}

// ============================================================================
// Personal Mode: Helper Functions
// ============================================================================

/**
 * Create a personal organization for a user
 *
 * Creates an organization specifically for personal mode where:
 * - Each user has exactly one organization
 * - The user is automatically the owner
 * - The organization is marked with personal=true and ownerId (Task 6.2)
 *
 * @param db - Drizzle database instance
 * @param userId - User ID (owner)
 * @param userName - User's name for workspace naming
 * @param userEmail - User's email (fallback for naming)
 * @param _appName - Application name (reserved for metadata)
 * @returns The created organization ID
 */
async function createPersonalOrg(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  userName: string | null,
  userEmail: string,
  _appName?: string
): Promise<string> {
  const orgId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Create organization name: "John's Workspace" or "john@email.com's Workspace"
  const displayName = userName || userEmail.split('@')[0]
  const orgName = `${displayName}'s Workspace`

  // Use user ID as slug for uniqueness (slugified)
  const slug = `personal-${userId.substring(0, 8)}`

  // Create the organization with personal and ownerId columns (Task 6.2)
  await db.run(sql`
    INSERT INTO organization (id, name, slug, personal, isDefault, ownerId, createdAt)
    VALUES (${orgId}, ${orgName}, ${slug}, 1, 0, ${userId}, ${now})
  `)

  // Add user as owner (member with 'owner' role)
  const memberId = crypto.randomUUID()
  await db.run(sql`
    INSERT INTO member (id, organizationId, userId, role, createdAt)
    VALUES (${memberId}, ${orgId}, ${userId}, 'owner', ${now})
  `)

  console.log(`[crouton/auth] Created personal organization "${orgName}" for user (personal mode)`)

  return orgId
}

/**
 * Get the user's personal organization ID
 *
 * In personal mode, each user has exactly one organization where they are the owner.
 * Uses the ownerId column for efficient lookup (Task 6.2).
 *
 * @param db - Drizzle database instance
 * @param userId - User ID to find personal org for
 * @returns Organization ID or null if not found
 */
async function getUserPersonalOrgId(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string
): Promise<string | null> {
  // Find personal organization by ownerId (Task 6.2 - indexed column)
  const result = await db.all(sql`
    SELECT id FROM organization
    WHERE personal = 1 AND ownerId = ${userId}
    LIMIT 1
  `)

  if (result.length === 0) {
    return null
  }

  return (result[0] as { id: string }).id
}

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Build plugins array based on @crouton/auth configuration
 *
 * Always includes: organization (teams)
 * Conditionally includes: passkey (if enabled), twoFactor (if enabled)
 *
 * @param config - @crouton/auth configuration
 * @param baseURL - Application base URL
 * @param debug - Enable debug logging
 * @param db - Drizzle database instance
 * @returns Array of Better Auth plugins
 */
function buildPlugins(
  config: CroutonAuthConfig,
  baseURL: string,
  debug?: boolean,
  db?: DrizzleD1Database<Record<string, unknown>>
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typing as BetterAuthPlugin[] widens the tuple betterAuth infers auth.api's plugin endpoints from
  const plugins: any[] = [
    // Organization plugin is always enabled (teams support)
    // Cast to any to work around strict typing - config is validated at runtime
    organization(buildOrganizationConfig(config, db) as any),

    // Admin plugin - user management (ban, impersonate, revoke sessions, etc.)
    admin({
      defaultRole: 'user',
      adminRoles: ['admin']
    }),

    // Password breach checking via Have I Been Pwned API
    // Only sends first 5 chars of password hash - full password never leaves the server
    //
    // KNOWN ISSUE: The plugin calls getCurrentAuthContext() (AsyncLocalStorage) inside
    // password.hash(). On Cloudflare Workers, ALS context can be lost during certain
    // endpoints (confirmed: /reset-password). Excluding /reset-password from paths
    // doesn't help because getCurrentAuthContext() is called BEFORE the path check.
    // Disabling until better-auth fixes the ALS dependency in the plugin's init() hook.
    // TODO: Re-enable when better-auth fixes haveIBeenPwned for CF Workers
    // haveIBeenPwned(),

    // Internationalized auth error messages
    // Detects locale from header, cookie, or session
    i18n({
      defaultLocale: 'en',
      translations: {
        nl: {
          USER_NOT_FOUND: 'Gebruiker niet gevonden',
          INVALID_EMAIL_OR_PASSWORD: 'Ongeldig e-mailadres of wachtwoord',
          EMAIL_NOT_VERIFIED: 'E-mailadres niet geverifieerd',
          PASSWORD_TOO_SHORT: 'Wachtwoord is te kort',
          PASSWORD_TOO_LONG: 'Wachtwoord is te lang',
          USER_ALREADY_EXISTS: 'Er bestaat al een account met dit e-mailadres',
          SESSION_EXPIRED: 'Sessie verlopen, log opnieuw in',
          INVALID_TOKEN: 'Ongeldige of verlopen token',
          INVALID_EMAIL: 'Ongeldig e-mailadres',
          SOCIAL_ACCOUNT_ALREADY_LINKED: 'Dit sociale account is al gekoppeld',
          FAILED_TO_CREATE_USER: 'Kon gebruiker niet aanmaken',
          PASSWORD_COMPROMISED: 'Dit wachtwoord is gelekt in een datalek. Kies een ander wachtwoord.'
        },
        fr: {
          USER_NOT_FOUND: 'Utilisateur non trouvé',
          INVALID_EMAIL_OR_PASSWORD: 'Email ou mot de passe invalide',
          EMAIL_NOT_VERIFIED: 'Adresse email non vérifiée',
          PASSWORD_TOO_SHORT: 'Le mot de passe est trop court',
          PASSWORD_TOO_LONG: 'Le mot de passe est trop long',
          USER_ALREADY_EXISTS: 'Un compte existe déjà avec cette adresse email',
          SESSION_EXPIRED: 'Session expirée, veuillez vous reconnecter',
          INVALID_TOKEN: 'Jeton invalide ou expiré',
          INVALID_EMAIL: 'Adresse email invalide',
          SOCIAL_ACCOUNT_ALREADY_LINKED: 'Ce compte social est déjà lié',
          FAILED_TO_CREATE_USER: 'Impossible de créer l\'utilisateur',
          PASSWORD_COMPROMISED: 'Ce mot de passe a été compromis dans une fuite de données. Veuillez en choisir un autre.'
        }
      }
    })
  ]

  // Conditionally add passkey plugin
  const passkeyPluginConfig = buildPasskeyConfig(config.methods?.passkeys, baseURL)
  if (passkeyPluginConfig) {
    plugins.push(passkey(passkeyPluginConfig))
  }

  // Conditionally add 2FA plugin
  const twoFactorPluginConfig = buildTwoFactorConfig(config.methods?.twoFactor, config.appName)
  if (twoFactorPluginConfig) {
    plugins.push(twoFactor(twoFactorPluginConfig))
  }

  // Conditionally add magic link plugin
  const magicLinkConfig = config.methods?.magicLink
  if (magicLinkConfig !== false && magicLinkConfig !== undefined) {
    const expiresIn = (typeof magicLinkConfig === 'object' && magicLinkConfig.expiresIn)
      ? magicLinkConfig.expiresIn
      : 300 // 5 minutes default
    plugins.push(magicLink({
      expiresIn,
      sendMagicLink: async ({ email, url }: { email: string, url: string }) => {
        if (debug) {
          console.log(`[crouton/auth] Magic link for ${email}: ${url}`)
        }
        let _event: any; try { _event = useEvent() } catch {}
        await useNitroApp().hooks.callHook('crouton:auth:email', {
          _event,
          type: 'magic-link',
          to: email,
          url
        }).catch(() => {})
      }
    }))
  }

  return plugins
}

// ============================================================================
// Passkey (WebAuthn) Configuration
// ============================================================================

/**
 * Build passkey plugin configuration from @crouton/auth config
 *
 * Passkeys provide passwordless authentication using WebAuthn.
 * Supports:
 * - Platform authenticators (fingerprint, Face ID, Windows Hello)
 * - Cross-platform authenticators (hardware security keys)
 * - Conditional UI (autofill support)
 *
 * @param passkeyConfig - Passkey configuration from @crouton/auth
 * @param baseURL - Application base URL for origin
 * @returns Passkey plugin configuration or null if disabled
 */
function buildPasskeyConfig(
  passkeyConfig: boolean | PasskeyConfig | undefined,
  baseURL: string
): PasskeyPluginOptions | null {
  // Check if passkeys are enabled
  if (passkeyConfig === false || passkeyConfig === undefined) {
    return null
  }

  // Parse base URL to get origin and default rpID
  const url = new URL(baseURL)
  const origin = url.origin
  const defaultRpId = url.hostname

  // Use defaults if just `true`
  if (passkeyConfig === true) {
    return {
      rpID: defaultRpId,
      rpName: 'Application',
      origin
    }
  }

  // Custom passkey configuration
  const customConfig = passkeyConfig as PasskeyConfig

  // If explicitly disabled via config object
  if (customConfig.enabled === false) {
    return null
  }

  return {
    rpID: customConfig.rpId ?? defaultRpId,
    rpName: customConfig.rpName ?? 'Application',
    origin,
    // Additional WebAuthn options for credential creation
    authenticatorSelection: {
      // Default to platform authenticators for better UX (fingerprint, Face ID)
      // Users can specify 'cross-platform' for hardware keys
      authenticatorAttachment: undefined, // Allow both platform and cross-platform
      // Require resident key for usernameless authentication
      residentKey: 'preferred',
      // Require user verification (biometric or PIN)
      userVerification: 'preferred'
    }
  }
}

/**
 * Passkey plugin options type
 */
interface PasskeyPluginOptions {
  /** Relying Party ID - typically the domain (e.g., 'example.com') */
  rpID: string
  /** Relying Party Name - human-readable app name */
  rpName: string
  /** Origin URL - server URL without trailing slash */
  origin: string
  /** Authenticator selection criteria */
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'required' | 'preferred' | 'discouraged'
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }
}

// ============================================================================
// Two-Factor Authentication (2FA) Configuration
// ============================================================================

/**
 * Build 2FA plugin configuration from @crouton/auth config
 *
 * Two-factor authentication adds an extra layer of security by requiring
 * a second verification step during login.
 *
 * Supports:
 * - TOTP (Time-based One-Time Password) via authenticator apps
 * - Backup codes for account recovery
 * - Trusted device management (skip 2FA on trusted devices)
 *
 * @param twoFactorConfigInput - 2FA configuration from @crouton/auth
 * @param appName - Application name for TOTP issuer
 * @returns 2FA plugin configuration or null if disabled
 */
function buildTwoFactorConfig(
  twoFactorConfigInput: boolean | TwoFactorConfig | undefined,
  appName?: string
): TwoFactorOptions | null {
  // Check if 2FA is enabled
  if (twoFactorConfigInput === false || twoFactorConfigInput === undefined) {
    return null
  }

  // Use defaults if just `true`
  if (twoFactorConfigInput === true) {
    return {
      issuer: appName ?? 'Application',
      // TOTP defaults
      totpOptions: {
        digits: 6,
        period: 30
      },
      // Backup codes defaults
      backupCodeOptions: {
        amount: 10,
        length: 10
      }
    }
  }

  // Custom 2FA configuration
  const customConfig = twoFactorConfigInput as TwoFactorConfig

  // If explicitly disabled via config object
  if (customConfig.enabled === false) {
    return null
  }

  // Build TOTP options if enabled (default: true)
  const totpEnabled = customConfig.totp !== false
  const totpOptions = totpEnabled
    ? {
        digits: 6,
        period: 30
      }
    : undefined

  // Build backup code options
  const backupCodeOptions = {
    amount: customConfig.backupCodesCount ?? 10,
    length: 10
  }

  return {
    issuer: customConfig.issuer ?? appName ?? 'Application',
    // Only include TOTP options if enabled
    ...(totpOptions && { totpOptions }),
    // Always include backup codes
    backupCodeOptions,
    // Skip verification on enable is false by default for security
    skipVerificationOnEnable: false
  } as TwoFactorOptions
}

// TwoFactorOptions type is now imported from 'better-auth/plugins'

// ============================================================================
// 2FA Utility Functions
// ============================================================================

/**
 * Check if 2FA is enabled in the configuration
 *
 * @param config - @crouton/auth configuration
 * @returns True if 2FA is enabled
 */
export function isTwoFactorEnabled(config: CroutonAuthConfig): boolean {
  const twoFactorConfig = config.methods?.twoFactor
  if (twoFactorConfig === undefined || twoFactorConfig === false) {
    return false
  }
  if (twoFactorConfig === true) {
    return true
  }
  return twoFactorConfig.enabled !== false
}

/**
 * Get 2FA configuration details for UI display
 *
 * @param config - @crouton/auth configuration
 * @returns 2FA info for UI or null if disabled
 */
export function getTwoFactorInfo(config: CroutonAuthConfig): TwoFactorInfo | null {
  if (!isTwoFactorEnabled(config)) {
    return null
  }

  const twoFactorConfig = config.methods?.twoFactor
  const customConfig = typeof twoFactorConfig === 'object' ? twoFactorConfig : {}

  return {
    enabled: true,
    hasTotp: customConfig.totp !== false,
    hasTrustedDevices: customConfig.trustedDevices !== false,
    backupCodesCount: customConfig.backupCodesCount ?? 10,
    issuer: customConfig.issuer ?? config.appName ?? 'Application',
    trustedDeviceExpiryDays: customConfig.trustedDeviceExpiry ?? 30
  }
}

/**
 * 2FA info for UI display
 */
export interface TwoFactorInfo {
  /** Whether 2FA is enabled */
  enabled: boolean
  /** Whether TOTP (authenticator app) is available */
  hasTotp: boolean
  /** Whether trusted device management is available */
  hasTrustedDevices: boolean
  /** Number of backup codes generated */
  backupCodesCount: number
  /** Issuer name for authenticator apps */
  issuer: string
  /** How many days a trusted device stays trusted */
  trustedDeviceExpiryDays: number
}

// ============================================================================
// OAuth/Social Providers Configuration
// ============================================================================

/**
 * Better Auth social provider configuration type
 */
type SocialProviderConfig = {
  clientId: string
  clientSecret: string
  scope?: string[]
  redirectURI?: string
  disableSignUp?: boolean
  [key: string]: unknown
}

/**
 * Build social providers configuration from @crouton/auth OAuth config
 *
 * Supports GitHub, Google, Discord as built-in providers,
 * plus additional custom providers.
 *
 * @param oauthConfig - OAuth configuration from @crouton/auth config
 * @param baseURL - Application base URL for callback URLs
 * @returns Better Auth socialProviders configuration
 */
function buildSocialProvidersConfig(
  oauthConfig: OAuthConfig | undefined,
  _baseURL: string // Reserved for future use (custom callback URLs)
): BetterAuthOptions['socialProviders'] {
  if (!oauthConfig) {
    return undefined
  }

  const providers: Record<string, SocialProviderConfig> = {}

  // Configure GitHub OAuth
  if (oauthConfig.github) {
    providers.github = buildGitHubConfig(oauthConfig.github)
  }

  // Configure Google OAuth
  if (oauthConfig.google) {
    providers.google = buildGoogleConfig(oauthConfig.google)
  }

  // Configure Discord OAuth
  if (oauthConfig.discord) {
    providers.discord = buildDiscordConfig(oauthConfig.discord)
  }

  // Configure additional custom providers
  for (const [providerName, providerConfig] of Object.entries(oauthConfig)) {
    // Skip built-in providers (already handled above)
    if (['github', 'google', 'discord'].includes(providerName)) {
      continue
    }

    if (providerConfig) {
      providers[providerName] = buildGenericProviderConfig(providerConfig)
    }
  }

  // Return undefined if no providers configured
  if (Object.keys(providers).length === 0) {
    return undefined
  }

  return providers
}

/**
 * Build GitHub OAuth provider configuration
 *
 * GitHub requires `user:email` scope to access email addresses.
 * By default, this scope is included.
 */
function buildGitHubConfig(config: GitHubOAuthConfig): SocialProviderConfig {
  // GitHub MUST include user:email scope
  const defaultScopes = ['user:email']
  const scopes = config.scopes?.length
    ? [...new Set([...defaultScopes, ...config.scopes])]
    : defaultScopes

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: scopes,
    disableSignUp: config.allowSignUp === false
  }
}

/**
 * Build Google OAuth provider configuration
 *
 * Google provides email and profile by default.
 * Set accessType to 'offline' to get refresh tokens.
 */
function buildGoogleConfig(config: GoogleOAuthConfig): SocialProviderConfig {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.scopes,
    disableSignUp: config.allowSignUp === false,
    // Ensure we can get refresh tokens (Google only issues on first consent)
    accessType: 'offline' as const,
    // Always show account selector for better UX
    prompt: 'select_account' as const
  }
}

/**
 * Build Discord OAuth provider configuration
 *
 * Discord provides identify and email scopes by default.
 */
function buildDiscordConfig(config: DiscordOAuthConfig): SocialProviderConfig {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.scopes,
    disableSignUp: config.allowSignUp === false
  }
}

/**
 * Build generic OAuth provider configuration
 *
 * Used for additional providers beyond GitHub, Google, and Discord.
 * Follows the base OAuthProviderConfig interface.
 */
function buildGenericProviderConfig(config: OAuthProviderConfig): SocialProviderConfig {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.scopes
  }
}

/**
 * Organization (Teams) Plugin Configuration
 *
 * Maps @crouton/auth config to Better Auth's organization plugin.
 * Uses configuration flags to control behavior:
 *
 * - `allowCreate`: Whether users can create new organizations
 * - `limit`: Maximum organizations per user (0 = unlimited)
 * - `autoCreateOnSignup`: Auto-create personal workspace
 * - `defaultTeamSlug`: Everyone joins this team on signup
 */
function buildOrganizationConfig(
  config: CroutonAuthConfig,
  db?: DrizzleD1Database<Record<string, unknown>>
) {
  const teamsConfig = config.teams ?? {}

  // Determine if users can create organizations
  // If autoCreateOnSignup or defaultTeamSlug is set AND allowCreate is not explicitly true,
  // default to false (users don't create orgs manually in these patterns)
  const hasAutoTeamSetup = teamsConfig.autoCreateOnSignup || teamsConfig.defaultTeamSlug
  const getAllowUserToCreateOrganization = () => {
    if (teamsConfig.allowCreate !== undefined) {
      return teamsConfig.allowCreate
    }
    // Default: false if auto-setup is configured, true otherwise
    return !hasAutoTeamSetup
  }

  // Determine organization limit
  // Better Auth interprets undefined as unlimited, 0 would mean "no orgs allowed"
  const getOrganizationLimit = (): number | undefined => {
    const limit = teamsConfig.limit
    // If limit is 0 or undefined, return undefined (unlimited in Better Auth)
    if (limit === undefined || limit === 0) {
      return undefined
    }
    return limit
  }

  return {
    // Organization creation control
    allowUserToCreateOrganization: getAllowUserToCreateOrganization(),

    // Organization limit per user (0 = unlimited)
    organizationLimit: getOrganizationLimit(),

    // Member limit per organization
    membershipLimit: teamsConfig.memberLimit ?? 100,

    // Creator gets "owner" role
    creatorRole: 'owner' as const,

    // Invitation configuration
    invitationExpiresIn: teamsConfig.invitationExpiry ?? 172800, // 48 hours default
    cancelPendingInvitationsOnReInvite: true,
    requireEmailVerificationOnInvitation: teamsConfig.requireEmailVerification ?? false,

    // Send invitation email via Nitro hook
    sendInvitationEmail: async (data: {
      id: string
      email: string
      organization: { name: string, id: string }
      inviter: { user: { name: string, email: string } }
      role: string
      expiresAt: Date
    }) => {
      if (config.debug) {
        console.log(`[crouton/auth] Invitation for ${data.email} to ${data.organization.name} (id: ${data.id})`)
      }
      console.log(`[crouton/auth] 📧 sendInvitationEmail called for ${data.email} to org "${data.organization.name}" (invitationId: ${data.id})`)
      let _event: any; try { _event = useEvent() } catch {}
      try {
        await useNitroApp().hooks.callHook('crouton:auth:email', {
          _event,
          type: 'invitation',
          to: data.email,
          invitationId: data.id,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name,
          inviterEmail: data.inviter.user.email,
          role: data.role,
          expiresAt: data.expiresAt
        })
        console.log(`[crouton/auth] ✅ crouton:auth:email hook completed for ${data.email}`)
      }
      catch (err) {
        console.error(`[crouton/auth] ❌ crouton:auth:email hook FAILED for ${data.email}:`, err)
      }
    },

    // Organization lifecycle hooks
    organizationHooks: buildOrganizationHooks(config, db)
  }
}

/**
 * Build organization lifecycle hooks
 */
function buildOrganizationHooks(
  config: CroutonAuthConfig,
  db?: DrizzleD1Database<Record<string, unknown>>
) {
  const teams = config.teams ?? {}

  return {
    // After organization is created
    afterCreateOrganization: async (ctx: {
      organization: { id: string, name: string, slug: string }
      user: { id: string, name: string }
    }) => {
      // Set ownerId on the organization (Better Auth doesn't do this automatically)
      if (db) {
        try {
          await db.run(sql`
            UPDATE organization SET ownerId = ${ctx.user.id} WHERE id = ${ctx.organization.id}
          `)
          if (config.debug) {
            console.log(`[crouton/auth] Set ownerId ${ctx.user.id} on organization ${ctx.organization.id}`)
          }
        } catch (e) {
          console.error(`[crouton/auth] Failed to set ownerId on organization:`, e)
        }
      }

      // Emit operation event for team creation
      useNitroApp().hooks.callHook('crouton:operation', {
        type: 'auth:team:created',
        source: 'crouton-auth',
        teamId: ctx.organization.id,
        userId: ctx.user.id,
        metadata: { teamName: ctx.organization.name },
        timestamp: Date.now()
      }).catch(() => {})

      if (config.debug) {
        console.log(`[crouton/auth] Organization created:`, {
          id: ctx.organization.id,
          name: ctx.organization.name,
          slug: ctx.organization.slug,
          ownerId: ctx.user.id
        })
      }
    },

    // After member is added
    afterAddMember: async (ctx: {
      member: { id: string, role: string }
      user: { id: string, name: string, email: string }
      organization: { id: string, name: string }
    }) => {
      // Emit operation event for member addition
      useNitroApp().hooks.callHook('crouton:operation', {
        type: 'auth:team:member-added',
        source: 'crouton-auth',
        teamId: ctx.organization.id,
        userId: ctx.user.id,
        metadata: { role: ctx.member.role },
        timestamp: Date.now()
      }).catch(() => {})

      if (config.debug) {
        console.log(`[crouton/auth] Member added:`, {
          userId: ctx.user.id,
          organizationId: ctx.organization.id,
          role: ctx.member.role
        })
      }
    },

    // After member is removed
    afterRemoveMember: async (ctx: {
      member: { id: string, role: string }
      user: { id: string, name: string, email: string }
      organization: { id: string, name: string }
    }) => {
      // Emit operation event for member removal
      useNitroApp().hooks.callHook('crouton:operation', {
        type: 'auth:team:member-removed',
        source: 'crouton-auth',
        teamId: ctx.organization.id,
        userId: ctx.user.id,
        metadata: {},
        timestamp: Date.now()
      }).catch(() => {})

      if (config.debug) {
        console.log(`[crouton/auth] Member removed:`, {
          userId: ctx.user.id,
          organizationId: ctx.organization.id
        })
      }
    },

    // Before creating invitation - validate based on config
    beforeCreateInvitation: async (ctx: {
      invitation: { email: string, role: string, expiresAt: Date }
      organization: { id: string, slug?: string }
    }) => {
      // If defaultTeamSlug is set, only allow invitations for that team
      // (This is the "company app" pattern where everyone belongs to one org)
      if (teams.defaultTeamSlug && !teams.allowCreate) {
        // We need to check if this org is the default one
        // Since we only have the ID, we can't easily compare to slug here
        // This validation is best done at the API route level
        // For now, we just apply the default role
      }

      // Apply default role if configured
      const defaultRole = teams.defaultRole ?? 'member'
      return {
        data: {
          ...ctx.invitation,
          role: ctx.invitation.role || defaultRole
        }
      }
    }
  }
}

// ============================================================================
// OAuth Provider Utilities
// ============================================================================

/**
 * Supported OAuth provider names
 */
export type SupportedOAuthProvider = 'github' | 'google' | 'discord' | string

/**
 * OAuth provider info for UI display
 */
export interface OAuthProviderInfo {
  /** Provider identifier */
  id: SupportedOAuthProvider
  /** Display name */
  name: string
  /** Icon name (for Nuxt UI icons) */
  icon: string
  /** Brand color (hex) */
  color: string
}

/**
 * Built-in OAuth provider metadata
 */
const BUILTIN_PROVIDERS: Record<string, Omit<OAuthProviderInfo, 'id'>> = {
  github: {
    name: 'GitHub',
    icon: 'i-lucide-github',
    color: '#24292e'
  },
  google: {
    name: 'Google',
    icon: 'i-simple-icons-google',
    color: '#4285f4'
  },
  discord: {
    name: 'Discord',
    icon: 'i-simple-icons-discord',
    color: '#5865f2'
  }
}

/**
 * Get list of configured OAuth providers from config
 *
 * @param oauthConfig - OAuth configuration
 * @returns Array of configured provider info for UI display
 */
export function getConfiguredOAuthProviders(
  oauthConfig: OAuthConfig | undefined
): OAuthProviderInfo[] {
  if (!oauthConfig) {
    return []
  }

  const providers: OAuthProviderInfo[] = []

  for (const [providerId, providerConfig] of Object.entries(oauthConfig)) {
    if (!providerConfig) continue

    const builtin = BUILTIN_PROVIDERS[providerId]
    if (builtin) {
      providers.push({
        id: providerId,
        ...builtin
      })
    } else {
      // Custom provider - use ID as name, generic icon
      providers.push({
        id: providerId,
        name: providerId.charAt(0).toUpperCase() + providerId.slice(1),
        icon: 'i-lucide-key-round',
        color: '#6b7280'
      })
    }
  }

  return providers
}

/**
 * Check if a specific OAuth provider is configured
 *
 * @param oauthConfig - OAuth configuration
 * @param provider - Provider name to check
 * @returns True if the provider is configured
 */
export function isOAuthProviderConfigured(
  oauthConfig: OAuthConfig | undefined,
  provider: string
): boolean {
  if (!oauthConfig) return false
  const config = oauthConfig[provider]
  return !!config && !!config.clientId && !!config.clientSecret
}

/**
 * Get the OAuth callback URL for a provider
 *
 * Better Auth uses the pattern: /api/auth/callback/{provider}
 *
 * @param baseURL - Application base URL
 * @param provider - Provider name
 * @returns Full callback URL
 */
export function getOAuthCallbackURL(baseURL: string, provider: string): string {
  const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
  return `${base}/api/auth/callback/${provider}`
}

// ============================================================================
// Passkey Utilities
// ============================================================================

/**
 * Check if passkeys are enabled in the configuration
 *
 * @param config - @crouton/auth configuration
 * @returns True if passkeys are enabled
 */
export function isPasskeyEnabled(config: CroutonAuthConfig): boolean {
  const passkeyConfig = config.methods?.passkeys
  if (passkeyConfig === undefined || passkeyConfig === false) {
    return false
  }
  if (passkeyConfig === true) {
    return true
  }
  return passkeyConfig.enabled !== false
}

/**
 * Get passkey configuration details for UI display
 *
 * @param config - @crouton/auth configuration
 * @returns Passkey info for UI or null if disabled
 */
export function getPasskeyInfo(config: CroutonAuthConfig): PasskeyInfo | null {
  if (!isPasskeyEnabled(config)) {
    return null
  }

  const passkeyConfig = config.methods?.passkeys
  const customConfig = typeof passkeyConfig === 'object' ? passkeyConfig : {}

  return {
    enabled: true,
    rpName: customConfig.rpName ?? 'Application',
    conditionalUI: customConfig.conditionalUI !== false,
    supportsAutofill: customConfig.conditionalUI !== false
  }
}

/**
 * Passkey info for UI display
 */
export interface PasskeyInfo {
  /** Whether passkeys are enabled */
  enabled: boolean
  /** Relying Party Name (app name shown in browser dialogs) */
  rpName: string
  /** Whether conditional UI (autofill) is supported */
  conditionalUI: boolean
  /** Alias for conditionalUI */
  supportsAutofill: boolean
}

/**
 * Check if WebAuthn is supported in the current environment
 *
 * This is a helper for client-side code to check browser support.
 * Use this before showing passkey UI elements.
 *
 * @returns True if WebAuthn is available
 */
export function isWebAuthnSupported(): boolean {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') {
    return false
  }

  // Check for WebAuthn support
  return (
    typeof PublicKeyCredential !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.credentials !== 'undefined'
  )
}

/**
 * Check if conditional UI (autofill) is available
 *
 * Conditional UI allows passkey authentication through browser autofill.
 * Not all browsers support this feature.
 *
 * @returns Promise resolving to true if conditional UI is available
 */
export async function isConditionalUIAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    return false
  }

  // Check for conditional mediation support
  // PublicKeyCredential is guaranteed to be defined after isWebAuthnSupported check
  if (!PublicKeyCredential || typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function') {
    return false
  }

  try {
    return await PublicKeyCredential.isConditionalMediationAvailable()
  } catch {
    return false
  }
}

// ============================================================================
// Auth Instance Management
// ============================================================================

/**
 * Type for the created auth instance
 */
export type AuthInstance = ReturnType<typeof createAuth>

/**
 * Server-side auth instance holder
 *
 * This is set by the auth-init plugin and used throughout the server.
 * Use `useServerAuth()` to access it safely.
 */
let _authInstance: AuthInstance | null = null

/**
 * Set the global auth instance (called by auth-init plugin)
 */
export function setAuthInstance(auth: AuthInstance): void {
  _authInstance = auth
}

/**
 * Get the global auth instance
 *
 * @throws Error if auth is not initialized
 */
export function getAuthInstance(): AuthInstance {
  if (!_authInstance) {
    throw new Error(
      '[crouton/auth] Auth not initialized. Make sure the auth-init plugin has run.'
    )
  }
  return _authInstance
}

/**
 * Check if auth is initialized
 */
export function isAuthInitialized(): boolean {
  return _authInstance !== null
}
