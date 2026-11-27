/**
 * Type declarations for #crouton/team-auth Nitro alias
 *
 * This module provides Better Auth-compatible team authentication utilities
 * for server-side code in nuxt-crouton collections.
 *
 * When using @crouton/auth, this alias is overridden to use Better Auth
 * instead of the default direct database queries.
 */
declare module '#crouton/team-auth' {
  import type { H3Event } from 'h3'

  /**
   * Team entity (mapped from Better Auth organization)
   */
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

  /**
   * User entity (from Better Auth user)
   */
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

  /**
   * Team membership entity (mapped from Better Auth member)
   */
  export interface TeamMembership {
    id?: string
    teamId: string
    userId: string
    role?: 'owner' | 'admin' | 'member' | string
    organizationId?: string
    createdAt?: Date
    [key: string]: unknown
  }

  /**
   * Result of resolveTeamAndCheckMembership
   */
  export interface TeamAuthResult {
    team: Team
    user: User
    membership: TeamMembership
  }

  /**
   * Team context (alias for TeamAuthResult)
   */
  export interface TeamContext {
    team: Team
    user: User
    membership: TeamMembership
  }

  /**
   * Resolves a team by slug or ID and verifies user membership
   *
   * Uses Better Auth's organization API to:
   * 1. Authenticate the user via session
   * 2. Resolve the team from URL param or session's activeOrganizationId
   * 3. Verify the user is a member of the team
   *
   * @param event - The H3 event object
   * @returns Object containing the team, user, and membership
   * @throws 401 if not authenticated
   * @throws 403 if user is not a team member
   * @throws 404 if team not found
   *
   * @example
   * ```typescript
   * export default defineEventHandler(async (event) => {
   *   const { team, user, membership } = await resolveTeamAndCheckMembership(event)
   *   // team.id is the organization ID
   *   // user.id is the authenticated user's ID
   *   // membership.role is 'owner' | 'admin' | 'member'
   * })
   * ```
   */
  export function resolveTeamAndCheckMembership(event: H3Event): Promise<TeamAuthResult>

  /**
   * Check if user is a member of a team (with event context)
   *
   * Preferred method when you have access to the H3 event.
   * Uses Better Auth's organization API to verify membership.
   *
   * @param event - H3 event
   * @param teamId - Team/organization ID
   * @param userId - User ID
   * @returns Promise<boolean>
   */
  export function isTeamMemberWithEvent(
    event: H3Event,
    teamId: string,
    userId: string
  ): Promise<boolean>

  /**
   * Get membership details for a user in a team
   *
   * @param event - H3 event
   * @param teamId - Team/organization ID
   * @param userId - User ID
   * @returns Membership or null
   */
  export function getMembership(
    event: H3Event,
    teamId: string,
    userId: string
  ): Promise<TeamMembership | null>

  /**
   * Get team by ID
   *
   * @param event - H3 event
   * @param teamId - Team/organization ID
   * @returns Team or null
   */
  export function getTeamById(event: H3Event, teamId: string): Promise<Team | null>

  /**
   * Get team by slug
   *
   * @param event - H3 event
   * @param slug - Team slug
   * @returns Team or null
   */
  export function getTeamBySlug(event: H3Event, slug: string): Promise<Team | null>

  /**
   * Get all teams for the authenticated user
   *
   * @param event - H3 event
   * @returns Array of teams
   */
  export function getUserTeams(event: H3Event): Promise<Team[]>

  /**
   * Require user to have specific role in team
   *
   * @param event - H3 event
   * @param requiredRole - Minimum role required
   * @returns TeamContext if authorized
   * @throws 403 if insufficient role
   */
  export function requireTeamRole(
    event: H3Event,
    requiredRole: 'owner' | 'admin' | 'member'
  ): Promise<TeamContext>

  /**
   * Require user to be team admin (admin or owner)
   */
  export function requireTeamAdmin(event: H3Event): Promise<TeamContext>

  /**
   * Require user to be team owner
   */
  export function requireTeamOwner(event: H3Event): Promise<TeamContext>

  /**
   * Check if user can create more teams
   *
   * @param event - H3 event
   * @param userId - User ID
   * @returns Boolean
   */
  export function canUserCreateTeam(event: H3Event, userId: string): Promise<boolean>

  /**
   * May `userId` do `action` (e.g. 'pages:edit') in team `teamId`? (#4104)
   * Reads the member's role from the database; no session needed.
   * Unknown action or non-member → false. Never throws.
   */
  export function can(teamId: string, userId: string, action: string): Promise<boolean>

  /**
   * Resolve the team from the request, then 403 unless the member `can` do `action`.
   */
  export function requireCan(event: H3Event, action: string): Promise<TeamContext>
}
