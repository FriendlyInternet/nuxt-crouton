/**
 * @crouton/auth Configuration Types
 *
 * Configuration interface for the @crouton/auth Nuxt layer.
 * Uses a unified "everything is a team" model where configuration flags control behavior.
 */

// ============================================================================
// OAuth Provider Configuration
// ============================================================================

/**
 * Base OAuth provider configuration
 */
export interface OAuthProviderConfig {
  /** OAuth client ID */
  clientId: string
  /** OAuth client secret */
  clientSecret: string
  /** Optional scopes to request */
  scopes?: string[]
}

/**
 * GitHub OAuth configuration
 */
export interface GitHubOAuthConfig extends OAuthProviderConfig {
  /** Allow sign-up via GitHub (default: true) */
  allowSignUp?: boolean
}

/**
 * Google OAuth configuration
 */
export interface GoogleOAuthConfig extends OAuthProviderConfig {
  /** Allow sign-up via Google (default: true) */
  allowSignUp?: boolean
}

/**
 * Discord OAuth configuration
 */
export interface DiscordOAuthConfig extends OAuthProviderConfig {
  /** Allow sign-up via Discord (default: true) */
  allowSignUp?: boolean
}

/**
 * OAuth providers configuration
 */
export interface OAuthConfig {
  github?: GitHubOAuthConfig
  google?: GoogleOAuthConfig
  discord?: DiscordOAuthConfig
  /** Additional OAuth providers */
  [key: string]: OAuthProviderConfig | undefined
}

// ============================================================================
// Authentication Method Configuration
// ============================================================================

/**
 * Password authentication configuration
 */
export interface PasswordConfig {
  /** Enable email/password authentication (default: true) */
  enabled?: boolean
  /** Minimum password length (default: 8) */
  minLength?: number
  /** Require uppercase letters */
  requireUppercase?: boolean
  /** Require lowercase letters */
  requireLowercase?: boolean
  /** Require numbers */
  requireNumbers?: boolean
  /** Require special characters */
  requireSpecialChars?: boolean
  /** Enable password reset via email (default: true) */
  resetEnabled?: boolean
}

/**
 * Passkey (WebAuthn) configuration
 */
export interface PasskeyConfig {
  /** Enable passkey authentication */
  enabled?: boolean
  /**
   * Relying Party ID (domain without protocol or port)
   * @example "example.com"
   */
  rpId?: string
  /**
   * Relying Party Name (human-readable app name)
   * @example "My Application"
   */
  rpName?: string
  /** Enable conditional UI (autofill) support (default: true) */
  conditionalUI?: boolean
}

/**
 * Two-factor authentication configuration
 */
export interface TwoFactorConfig {
  /** Enable 2FA support */
  enabled?: boolean
  /** Enable TOTP (authenticator app) support (default: true) */
  totp?: boolean
  /** Number of backup codes to generate (default: 10) */
  backupCodesCount?: number
  /** Enable trusted device management (default: true) */
  trustedDevices?: boolean
  /** Trusted device expiry in days (default: 30) */
  trustedDeviceExpiry?: number
  /** Issuer name for TOTP (shown in authenticator apps) */
  issuer?: string
}

/**
 * Magic link authentication configuration
 */
export interface MagicLinkConfig {
  /** Enable magic link authentication */
  enabled?: boolean
  /** Link expiry time in seconds (default: 300 = 5 minutes) */
  expiresIn?: number
}

/**
 * Phone/SMS authentication configuration
 */
export interface PhoneConfig {
  /** Enable phone/SMS authentication */
  enabled?: boolean
  /** SMS provider (e.g., 'twilio') */
  provider?: string
}

/**
 * Authentication methods configuration
 */
export interface AuthMethodsConfig {
  /**
   * Email/password authentication
   * Set to `true` for defaults, `false` to disable, or configure options
   */
  password?: boolean | PasswordConfig
  /**
   * OAuth providers configuration
   */
  oauth?: OAuthConfig
  /**
   * Passkey (WebAuthn) authentication
   * Set to `true` for defaults, `false` to disable, or configure options
   */
  passkeys?: boolean | PasskeyConfig
  /**
   * Two-factor authentication
   * Set to `true` for defaults, `false` to disable, or configure options
   */
  twoFactor?: boolean | TwoFactorConfig
  /**
   * Magic link authentication
   * Set to `true` for defaults, `false` to disable, or configure options
   */
  magicLink?: boolean | MagicLinkConfig
  /**
   * Phone/SMS authentication
   * Set to `true` for defaults, `false` to disable, or configure options
   */
  phone?: boolean | PhoneConfig
}

// ============================================================================
// Team Configuration
// ============================================================================

/**
 * Team (organization) configuration
 *
 * Common patterns:
 * - SaaS (multi-tenant): `{ allowCreate: true, showSwitcher: true }`
 * - Company app (single-tenant): `{ defaultTeamSlug: 'acme-corp', allowCreate: false, showSwitcher: false }`
 * - Personal app: `{ autoCreateOnSignup: true, allowCreate: false, showSwitcher: false }`
 */
export interface TeamsConfig {
  // =========================================================================
  // Team Creation Behavior (replaces mode)
  // =========================================================================

  /**
   * Auto-create a personal workspace on user signup
   *
   * When true, each new user gets their own workspace automatically.
   * The workspace is marked with `personal: true` and `ownerId: userId`.
   *
   * Use case: Personal productivity apps where each user has their own space.
   *
   * @default false
   */
  autoCreateOnSignup?: boolean

  /**
   * Default team slug that all users join on signup
   *
   * When set, all new users are automatically added to this team.
   * The team is auto-created on first boot if it doesn't exist.
   *
   * Use case: Company apps where everyone belongs to one team.
   *
   * @example 'acme-corp'
   * @default undefined
   */
  defaultTeamSlug?: string

  // =========================================================================
  // Team Creation Permissions
  // =========================================================================

  /**
   * Allow users to create new teams
   *
   * @default true
   */
  allowCreate?: boolean

  /**
   * Maximum number of teams per user (0 = unlimited)
   *
   * @default 0 (unlimited)
   */
  limit?: number

  // =========================================================================
  // UI Display Options
  // =========================================================================

  /**
   * Show team switcher in UI
   *
   * Set to false for single-team experiences where users don't need to switch.
   *
   * @default true
   */
  showSwitcher?: boolean

  /**
   * Show team management UI (settings, members, etc.)
   *
   * Set to false to hide team settings from users.
   *
   * @default true
   */
  showManagement?: boolean

  // =========================================================================
  // Team Membership Settings
  // =========================================================================

  /**
   * Maximum members per team (default: 100)
   */
  memberLimit?: number

  /**
   * Require email invitation to join team (default: true)
   */
  requireInvite?: boolean

  /**
   * Invitation link expiry in seconds (default: 172800 = 48 hours)
   */
  invitationExpiry?: number

  /**
   * Require email verification before accepting invitations (default: false)
   */
  requireEmailVerification?: boolean

  /**
   * Default role for new members (default: 'member')
   */
  defaultRole?: 'member' | 'admin'

  /**
   * Available roles in the team
   */
  roles?: TeamRole[]
}

/**
 * Team role definition
 */
export interface TeamRole {
  /** Role identifier */
  id: string
  /** Display name */
  name: string
  /** Role permissions */
  permissions?: string[]
}

// ============================================================================
// UI Configuration
// ============================================================================

/**
 * Redirect URLs configuration
 */
export interface RedirectConfig {
  /** Redirect after successful login (default: '/') */
  afterLogin?: string
  /** Redirect after logout (default: '/') */
  afterLogout?: string
  /** Redirect after registration (default: '/') */
  afterRegister?: string
  /** Redirect for unauthenticated users (default: '/auth/login') */
  unauthenticated?: string
  /** Redirect for already authenticated users on auth pages (default: '/') */
  authenticated?: string
  /** Redirect when user has no teams in multi-tenant mode (default: '/onboarding/create-team') */
  noTeams?: string
}

/**
 * UI configuration
 */
export interface UIConfig {
  /**
   * UI theme preset
   * 'default': Full-featured auth UI
   * 'minimal': Minimal, unstyled components
   */
  theme?: 'default' | 'minimal'
  /** Redirect URLs */
  redirects?: RedirectConfig
  /** Show "Remember me" checkbox on login (default: true) */
  showRememberMe?: boolean
  /** Show social login buttons (default: true if oauth configured) */
  showSocialLogin?: boolean
  /**
   * Show the "Go home" escape button in the auth modal (default: true).
   * Set to false for apps with no public landing page, where '/' just
   * bounces signed-out users back to login (the button would otherwise
   * strand them on a redirect loop).
   */
  showGoHome?: boolean
  /** Enable dark mode support (default: true) */
  darkMode?: boolean
}

// ============================================================================
// Session Configuration
// ============================================================================

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Session expiry in seconds (default: 604800 = 7 days) */
  expiresIn?: number
  /** Refresh session on activity (default: true) */
  updateAge?: number
  /** Cookie name (default: 'better-auth.session_token') */
  cookieName?: string
  /** Cookie secure flag (default: true in production) */
  secure?: boolean
  /** Cookie same-site attribute (default: 'lax') */
  sameSite?: 'strict' | 'lax' | 'none'
}

// ============================================================================
// Main Configuration Interface
// ============================================================================

/**
 * Main @crouton/auth configuration interface
 *
 * Uses a unified "everything is a team" model. Configuration flags in `teams`
 * control behavior instead of discrete modes.
 *
 * @example SaaS (multi-tenant style)
 * ```typescript
 * croutonAuth: {
 *   teams: { allowCreate: true, showSwitcher: true },
 *   methods: { password: true, oauth: { github: {...} } }
 * }
 * ```
 *
 * @example Company app (single-tenant style)
 * ```typescript
 * croutonAuth: {
 *   teams: { defaultTeamSlug: 'acme-corp', allowCreate: false, showSwitcher: false }
 * }
 * ```
 *
 * @example Personal app
 * ```typescript
 * croutonAuth: {
 *   teams: { autoCreateOnSignup: true, allowCreate: false, showSwitcher: false }
 * }
 * ```
 */
export interface CroutonAuthConfig {
  /**
   * Application name
   *
   * Used for auto-created team names and display purposes.
   *
   * @example 'My Company App'
   */
  appName?: string

  /**
   * Authentication methods configuration
   */
  methods?: AuthMethodsConfig

  /**
   * Who may create an account.
   *
   * - `'open'` (default): anyone can sign up.
   * - `'invite'`: only an email with a pending team invitation can sign up
   *   (password, magic link and OAuth alike). Super admins can still create users.
   *
   * @default 'open'
   */
  signup?: 'open' | 'invite'

  /**
   * Team (organization) configuration
   *
   * Controls team creation behavior, permissions, and UI display.
   * See TeamsConfig for common patterns.
   */
  teams?: TeamsConfig

  /**
   * UI configuration
   */
  ui?: UIConfig

  /**
   * Session configuration
   */
  session?: SessionConfig

  /**
   * Enable debug mode (default: false)
   * Enables verbose logging for debugging
   */
  debug?: boolean
}

/**
 * @deprecated Use TeamsConfig flags instead of AuthMode.
 *
 * Migration guide:
 * - `mode: 'multi-tenant'` → `teams: { allowCreate: true, showSwitcher: true }`
 * - `mode: 'single-tenant'` → `teams: { defaultTeamSlug: 'slug', allowCreate: false, showSwitcher: false }`
 * - `mode: 'personal'` → `teams: { autoCreateOnSignup: true, allowCreate: false, showSwitcher: false }`
 */
export type AuthMode = 'multi-tenant' | 'single-tenant' | 'personal'

// ============================================================================
// Runtime Configuration Types
// ============================================================================

/**
 * Server-side auth runtime config
 */
export interface AuthServerRuntimeConfig {
  /** BETTER_AUTH_SECRET - session encryption key */
  secret: string
  /** BETTER_AUTH_URL - application base URL */
  baseUrl: string
  /** OAuth provider secrets (server-only) */
  oauth?: {
    [provider: string]: {
      clientSecret: string
    }
  }
}

/**
 * Public auth runtime config
 */
export interface AuthPublicRuntimeConfig {
  crouton: {
    auth: CroutonAuthConfig
  }
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Resolve boolean | Config to Config
 */
export type ResolveConfig<T> = T extends boolean ? undefined : T

/**
 * Check if a method is enabled
 */
export function isMethodEnabled(
  method: boolean | object | undefined
): boolean {
  if (method === undefined) return false
  if (typeof method === 'boolean') return method
  return (method as { enabled?: boolean }).enabled !== false
}

/**
 * Get method config (returns undefined if disabled or boolean)
 */
export function getMethodConfig<T extends object>(
  method: boolean | T | undefined
): T | undefined {
  if (method === undefined || typeof method === 'boolean') return undefined
  return method
}
