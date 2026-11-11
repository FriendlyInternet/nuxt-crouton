/**
 * @crouton/auth Authentication Types
 *
 * Types for users, sessions, teams, members, and subscriptions.
 */

// ============================================================================
// User Types
// ============================================================================

/**
 * Authenticated user
 */
export interface User {
  /** Unique user ID */
  id: string
  /** User email address */
  email: string
  /** Whether email is verified */
  emailVerified: boolean
  /** User display name */
  name: string | null
  /** User avatar/profile image URL */
  image: string | null
  /** Account creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
  /** Site-level role (e.g. 'admin') */
  role?: string
  /** Super admin flag */
  superAdmin?: boolean
}

/**
 * User with extended profile data
 */
export interface UserProfile extends User {
  /** User's phone number (if phone auth enabled) */
  phone?: string | null
  /** Whether phone is verified */
  phoneVerified?: boolean
  /** Whether user has 2FA enabled */
  twoFactorEnabled?: boolean
  /** User's preferred language */
  locale?: string
  /** User's timezone */
  timezone?: string
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Active user session
 */
export interface Session {
  /** Session ID */
  id: string
  /** User ID */
  userId: string
  /** Session token (hashed) */
  token: string
  /** Session expiry timestamp */
  expiresAt: Date
  /** IP address of session creation */
  ipAddress?: string
  /** User agent string */
  userAgent?: string
  /** Currently active organization ID */
  activeOrganizationId?: string
  /** Session creation timestamp */
  createdAt: Date
  /** Last activity timestamp */
  updatedAt: Date
}

/**
 * Session with user data (from useSession)
 */
export interface SessionWithUser {
  session: Session
  user: User
}

// ============================================================================
// Team/Organization Types
// ============================================================================

/**
 * Team/Organization
 */
export interface Team {
  /** Unique team ID */
  id: string
  /** Team display name */
  name: string
  /** URL-friendly slug */
  slug: string
  /** Team logo/image URL */
  logo?: string | null
  /** Team metadata */
  metadata?: Record<string, unknown>
  /** Whether this is a personal workspace (personal mode) */
  personal?: boolean
  /** Whether this is the default team (single-tenant mode) */
  isDefault?: boolean
  /** Owner user ID for personal workspaces (Task 6.2) */
  ownerId?: string
  /** Team creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
}

/**
 * Team with additional computed properties
 */
export interface TeamWithStats extends Team {
  /** Number of members */
  memberCount: number
  /** Number of pending invitations */
  pendingInvitations: number
}

// ============================================================================
// Member Types
// ============================================================================

/**
 * Team member role
 */
export type MemberRole = 'owner' | 'admin' | 'member'

/**
 * Team membership
 */
export interface Member {
  /** Membership ID */
  id: string
  /** Organization/Team ID */
  organizationId: string
  /** User ID */
  userId: string
  /** Member role */
  role: MemberRole
  /** Membership creation timestamp */
  createdAt: Date
}

/**
 * Member with user details
 */
export interface MemberWithUser extends Member {
  user: User
}

/**
 * Team invitation
 */
export interface Invitation {
  /** Invitation ID */
  id: string
  /** Organization/Team ID */
  organizationId: string
  /** Invited email address */
  email: string
  /** Assigned role on acceptance */
  role: MemberRole
  /** Invitation status */
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  /** Inviter user ID */
  inviterId: string
  /** Invitation expiry timestamp */
  expiresAt: Date
  /** Invitation creation timestamp */
  createdAt: Date
}

/**
 * Invitation with inviter details
 */
export interface InvitationWithInviter extends Invitation {
  inviter: User
}

// ============================================================================
// OAuth Account Types
// ============================================================================

/**
 * Linked OAuth account
 */
export interface LinkedAccount {
  /** Account ID */
  id: string
  /** User ID */
  userId: string
  /** OAuth provider (github, google, discord, etc.) */
  provider: string
  /** Provider account ID */
  providerAccountId: string
  /** OAuth access token (encrypted) */
  accessToken?: string
  /** OAuth refresh token (encrypted) */
  refreshToken?: string
  /** Token expiry timestamp */
  expiresAt?: Date
  /** Account creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
}

// ============================================================================
// Passkey Types
// ============================================================================

/**
 * Registered passkey credential
 */
export interface Passkey {
  /** Passkey ID */
  id: string
  /** User ID */
  userId: string
  /** Credential public key */
  publicKey: string
  /** Credential ID (base64url encoded) */
  credentialId: string
  /** Authenticator counter */
  counter: number
  /** Device type (e.g., 'singleDevice', 'multiDevice') */
  deviceType: string
  /** Whether backed up to cloud */
  backedUp: boolean
  /** Authenticator AAGUID */
  aaguid?: string
  /** User-friendly name for the passkey */
  name?: string
  /** Last used timestamp */
  lastUsedAt?: Date
  /** Registration timestamp */
  createdAt: Date
}

// ============================================================================
// Auth Event Types
// ============================================================================

/**
 * Auth event types for hooks
 */
export type AuthEventType
  = | 'signIn'
    | 'signUp'
    | 'signOut'
    | 'passwordReset'
    | 'emailVerified'
    | 'teamCreated'
    | 'teamDeleted'
    | 'memberAdded'
    | 'memberRemoved'
    | 'memberRoleChanged'
    | 'invitationSent'
    | 'invitationAccepted'

/**
 * Auth event payload
 */
export interface AuthEvent<T = unknown> {
  type: AuthEventType
  data: T
  timestamp: Date
}
