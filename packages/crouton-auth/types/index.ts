/**
 * @crouton/auth Type Exports
 *
 * Re-exports all types from the package.
 */

// Nuxt type augmentation (side-effect import to ensure types are loaded)
import './nuxt.d'

// Auth client types
export type { CroutonAuthClient } from './auth-client'
export { useAuthClient, useAuthClientSafe } from './auth-client'

// Configuration types
export type {
  // OAuth
  OAuthProviderConfig,
  GitHubOAuthConfig,
  GoogleOAuthConfig,
  DiscordOAuthConfig,
  OAuthConfig,
  // Auth methods
  PasswordConfig,
  PasskeyConfig,
  TwoFactorConfig,
  MagicLinkConfig,
  PhoneConfig,
  AuthMethodsConfig,
  // Teams
  TeamsConfig,
  // UI
  RedirectConfig,
  UIConfig,
  // Session
  SessionConfig,
  // Main config
  AuthMode,
  CroutonAuthConfig,
  // Runtime config
  AuthServerRuntimeConfig,
  AuthPublicRuntimeConfig,
  // Helpers
  ResolveConfig
} from './config'

// Config helper functions
export {
  isMethodEnabled,
  getMethodConfig
} from './config'

// Auth types
export type {
  // User
  User,
  UserProfile,
  // Session
  Session,
  SessionWithUser,
  // Team
  Team,
  TeamWithStats,
  // Member
  MemberRole,
  Member,
  MemberWithUser,
  Invitation,
  InvitationWithInviter,
  // OAuth
  LinkedAccount,
  // Passkey
  Passkey,
  // Events
  AuthEventType,
  AuthEvent
} from './auth'

// Connector types (for nuxt-crouton integration)
export type {
  Team as ConnectorTeam,
  User as ConnectorUser,
  TeamMembership,
  TeamAuthResult,
  BetterAuthConnector,
  BetterAuthConnectorConfig,
  BetterAuthSession
} from './connector'

export {
  defaultBetterAuthConnectorConfig,
  isBetterAuthSession,
  isBetterAuthConnector
} from './connector'
