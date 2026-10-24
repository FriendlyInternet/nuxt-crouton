/**
 * Better Auth Connector for nuxt-crouton
 *
 * This module defines the connector interface that allows nuxt-crouton
 * to work with Better Auth instead of direct database queries.
 *
 * The connector maps:
 * - Better Auth `organization` → nuxt-crouton `teams`
 * - Better Auth `member` → nuxt-crouton `teamMembers`
 * - Better Auth session → nuxt-crouton user session
 */

import type { H3Event } from 'h3'

// ============================================================================
// Core Types (what nuxt-crouton's generated handlers expect from team auth)
// ============================================================================

export interface Team {
  id: string
  slug: string
  name: string
  logo?: string | null
  ownerId?: string
  metadata?: Record<string, unknown>
  personal?: boolean
  isDefault?: boolean
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

export interface User {
  id: string
  email: string
  name?: string | null
  emailVerified?: boolean
  image?: string | null
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

export interface TeamMembership {
  id?: string
  teamId: string
  userId: string
  role?: 'owner' | 'admin' | 'member' | string
  organizationId?: string // Better Auth uses organizationId
  createdAt?: Date
  [key: string]: unknown
}

export interface TeamAuthResult {
  team: Team
  user: User
  membership: TeamMembership
}

// ============================================================================
// Connector Configuration
// ============================================================================

/**
 * Better Auth connector configuration
 *
 * Maps Better Auth concepts to nuxt-crouton expectations
 */
export interface BetterAuthConnectorConfig {
  /**
   * Table name mappings
   * Maps nuxt-crouton expected names to Better Auth table names
   */
  tables: {
    /** nuxt-crouton expects 'teams', Better Auth uses 'organization' */
    teams: 'organization'
    /** nuxt-crouton expects 'teamMembers', Better Auth uses 'member' */
    teamMembers: 'member'
    /** Both use 'user' */
    users: 'user'
    /** Both use 'session' */
    sessions: 'session'
  }

  /**
   * Session format mapping
   * Maps Better Auth session fields to nuxt-crouton expectations
   */
  session: {
    /** Get user ID from Better Auth session */
    getUserId: (session: BetterAuthSession) => string
    /** Get active team/organization ID from Better Auth session */
    getTeamId: (session: BetterAuthSession) => string | undefined
    /** Get user object from Better Auth session */
    getUser: (session: BetterAuthSession) => User
  }
}

/**
 * Better Auth session structure
 */
export interface BetterAuthSession {
  session: {
    id: string
    userId: string
    token: string
    expiresAt: Date
    activeOrganizationId?: string
    ipAddress?: string
    userAgent?: string
    createdAt: Date
    updatedAt: Date
  }
  user: {
    id: string
    email: string
    emailVerified: boolean
    name: string | null
    image: string | null
    createdAt: Date
    updatedAt: Date
  }
}

// ============================================================================
// Connector Instance
// ============================================================================

/**
 * Better Auth Connector
 *
 * Implements the connector interface for nuxt-crouton integration
 */
export interface BetterAuthConnector {
  /**
   * Connector type identifier
   */
  type: 'better-auth'

  /**
   * Configuration
   */
  config: BetterAuthConnectorConfig

  /**
   * Resolve team and check membership
   * Compatible with nuxt-crouton's generated team-scoped handlers
   */
  resolveTeamAndCheckMembership: (event: H3Event) => Promise<TeamAuthResult>
}

// ============================================================================
// Default Connector Configuration
// ============================================================================

/**
 * Default Better Auth connector configuration
 */
export const defaultBetterAuthConnectorConfig: BetterAuthConnectorConfig = {
  tables: {
    teams: 'organization',
    teamMembers: 'member',
    users: 'user',
    sessions: 'session'
  },
  session: {
    getUserId: session => session.user.id,
    getTeamId: session => session.session.activeOrganizationId,
    getUser: session => ({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: session.user.emailVerified,
      image: session.user.image,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt
    })
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a session is a Better Auth session
 */
export function isBetterAuthSession(session: unknown): session is BetterAuthSession {
  return (
    typeof session === 'object'
    && session !== null
    && 'session' in session
    && 'user' in session
    && typeof (session as BetterAuthSession).session?.activeOrganizationId !== 'undefined'
    || typeof (session as BetterAuthSession).session?.userId === 'string'
  )
}

/**
 * Check if we're using Better Auth connector
 */
export function isBetterAuthConnector(connector: unknown): connector is BetterAuthConnector {
  return (
    typeof connector === 'object'
    && connector !== null
    && (connector as BetterAuthConnector).type === 'better-auth'
  )
}
