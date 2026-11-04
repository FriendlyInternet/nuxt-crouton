/**
 * Server Team Utilities
 *
 * Server-side team/organization helpers.
 * Unified team resolution from URL params or session.
 */
import type { H3Event } from 'h3'
import { createError, getRouterParam } from 'h3'
import { useRuntimeConfig } from '#imports'
import { sql, eq, and } from 'drizzle-orm'
import { organization, member as memberTable } from '../database/schema/auth'
import type { Team, Member, User } from '../../types'
import { mapOrganizationToTeam } from '../../shared/utils/auth'
import { useServerAuth, requireServerSession } from './useServerAuth'
import type { CroutonAuthConfig } from '../../types/config'

// Extended session type with organization plugin properties
interface OrganizationSession {
  session: {
    id: string
    userId: string
    expiresAt: Date
    activeOrganizationId?: string | null
  }
  user: User
}

// Organization API methods from Better Auth organization plugin
interface OrganizationApi {
  listMembers: (options: { query: { organizationId: string }, headers: Headers }) => Promise<{ members?: Array<{ id: string, userId: string, role: string, createdAt: string }> }>
  getFullOrganization: (options: { query: { organizationId?: string, organizationSlug?: string }, headers: Headers }) => Promise<{ id: string, name: string, slug: string, logo?: string | null, metadata?: string | null, personal?: boolean | number | null, isDefault?: boolean | number | null, ownerId?: string | null, createdAt: string | Date } | null>
  listOrganizations: (options: { headers: Headers }) => Promise<Array<{ id: string, name: string, slug: string, logo?: string | null, metadata?: string | null, personal?: boolean | number | null, isDefault?: boolean | number | null, ownerId?: string | null, createdAt: string | Date }>>
  createOrganization: (options: { body: { name: string, slug: string, metadata?: string }, headers: Headers }) => Promise<{ id: string, name: string, slug: string, logo?: string | null, metadata?: string | null, personal?: boolean | number | null, isDefault?: boolean | number | null, ownerId?: string | null, createdAt: string | Date }>
  setActiveOrganization: (options: { body: { organizationId: string }, headers: Headers }) => Promise<void>
}

// ============================================================================
// Core Team Resolution (Mode-Aware)
// ============================================================================

export interface TeamContext {
  team: Team
  user: User
  membership: Member
}

/**
 * Resolve team and check membership (mode-aware)
 *
 * This is the MAIN function for API routes to get team context.
 * It handles all three modes automatically:
 *
 * - Multi-tenant: Resolves from URL param or session
 * - Single-tenant: Always uses the default team
 * - Personal: Uses user's personal team from session
 *
 * @param event - H3 event
 * @returns Team context with team, user, and membership
 * @throws 401 if not authenticated
 * @throws 403 if not a team member
 * @throws 404 if team not found
 *
 * @example
 * ```typescript
 * export default defineEventHandler(async (event) => {
 *   const { team, user, membership } = await resolveTeamAndCheckMembership(event)
 *   // team is guaranteed to be valid
 *   // user is authenticated
 *   // membership is verified
 * })
 * ```
 */
export async function resolveTeamAndCheckMembership(event: H3Event): Promise<TeamContext> {
  // Get authenticated session from Better Auth (cast to extended type with org properties)
  const session = await requireServerSession(event) as OrganizationSession

  // Unified resolution: URL param first, then session's active org
  // From URL param (API routes use /teams/[id]/...)
  // Fall back to session's active org
  const teamId = getRouterParam(event, 'id') ?? session.session.activeOrganizationId ?? undefined

  if (!teamId) {
    throw createError({
      status: 400,
      message: 'No team context available'
    })
  }

  // Try to get team by ID first, then fall back to slug
  let team = await getTeamById(event, teamId)
  if (!team) {
    team = await getTeamBySlug(event, teamId)
  }

  // Only throw error if BOTH lookups failed
  if (!team) {
    throw createError({
      status: 404,
      message: 'Team not found'
    })
  }

  // Verify membership using the actual team ID (not the URL param which might be a slug)
  const membership = await getMembership(event, team.id, session.user.id)
  if (!membership) {
    throw createError({
      status: 403,
      message: 'Not a team member'
    })
  }

  return {
    team,
    user: session.user as User,
    membership
  }
}

/**
 * Resolve a team by slug or ID without requiring authentication.
 * Used for public-facing endpoints where team context is needed but auth is not.
 *
 * @param event - H3 event
 * @param paramName - Route parameter name to read (default: 'id')
 * @returns Object with resolved team
 * @throws 400 if no team identifier provided
 * @throws 404 if team not found
 *
 * @example
 * ```typescript
 * // Default: reads [id] param
 * const { team } = await resolveTeamBySlugOrId(event)
 *
 * // Custom param: reads [team] param
 * const { team } = await resolveTeamBySlugOrId(event, 'team')
 * ```
 */
export async function resolveTeamBySlugOrId(
  event: H3Event,
  paramName: string = 'id'
): Promise<{ team: Team }> {
  const identifier = getRouterParam(event, paramName)

  if (!identifier) {
    throw createError({
      status: 400,
      statusText: 'No team identifier provided'
    })
  }

  // Try to get team by ID first, then fall back to slug
  let team = await getTeamById(event, identifier)
  if (!team) {
    team = await getTeamBySlug(event, identifier)
  }

  if (!team) {
    throw createError({
      status: 404,
      statusText: 'Team not found'
    })
  }

  return { team }
}

/**
 * Get membership for a user in a team
 *
 * Uses Better Auth's organization API to check membership.
 *
 * @param event - H3 event (needed for auth instance)
 * @param teamId - Team/Organization ID
 * @param userId - User ID
 * @returns Member or null
 */
export async function getMembership(event: H3Event, teamId: string, userId: string, _userId?: string): Promise<Member | null> {
  try {
    const database = useDB()
    const results = await (database as any)
      .select()
      .from(memberTable)
      .where(and(eq(memberTable.organizationId, teamId), eq(memberTable.userId, userId)))
      .limit(1)

    if (!results || results.length === 0) return null
    const m = results[0]
    return {
      id: m.id,
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role as 'owner' | 'admin' | 'member',
      createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
    }
  } catch (error) {
    console.error('[crouton/auth] getMembership error:', error)
    return null
  }
}

// ============================================================================
// Team Lookup Functions
// ============================================================================

/**
 * Get team by ID
 *
 * Uses Better Auth's organization API to fetch team details.
 *
 * @param event - H3 event (needed for auth instance)
 * @param teamId - Team ID
 * @returns Team or null
 */
export async function getTeamById(event: H3Event, teamId: string): Promise<Team | null> {
  try {
    const database = useDB()
    const results = await (database as any)
      .select()
      .from(organization)
      .where(eq(organization.id, teamId))
      .limit(1)

    if (!results || results.length === 0) return null
    return mapOrganizationToTeam(results[0])
  } catch {
    return null
  }
}

/**
 * Get team by slug
 *
 * Uses Better Auth's organization API to fetch team by slug.
 *
 * @param event - H3 event (needed for auth instance)
 * @param slug - Team slug
 * @returns Team or null
 */
export async function getTeamBySlug(event: H3Event, slug: string): Promise<Team | null> {
  try {
    const database = useDB()
    const results = await (database as any)
      .select()
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1)

    if (!results || results.length === 0) return null
    return mapOrganizationToTeam(results[0])
  } catch {
    return null
  }
}

/**
 * Get user's teams/organizations
 *
 * @param event - H3 event (needed for auth instance)
 * @returns Array of teams the user belongs to
 */
export async function getUserTeams(event: H3Event): Promise<Team[]> {
  try {
    const auth = useServerAuth(event)
    const api = auth.api as unknown as OrganizationApi

    // Use Better Auth's organization API to list user's organizations
    const response = await api.listOrganizations({
      headers: event.headers
    })

    if (!response?.length) {
      return []
    }

    // Map Better Auth organizations to our Team type
    return response.map(mapOrganizationToTeam)
  } catch (error) {
    console.error('[crouton/auth] getUserTeams error:', error)
    return []
  }
}

/**
 * Get or create default organization
 *
 * Used when defaultTeamSlug is set to ensure a default org exists.
 * Can be called during request handling to lazily create the default org.
 *
 * Note: The default org is typically created automatically via databaseHooks
 * on first user signup. This function can be used to manually trigger
 * creation or fetch the default org.
 *
 * @param event - H3 event (needed for database access)
 * @returns The default organization
 */
export async function getOrCreateDefaultOrganization(event: H3Event): Promise<Team> {
  const config = useRuntimeConfig().public.crouton?.auth as CroutonAuthConfig | undefined
  const defaultTeamSlug = config?.teams?.defaultTeamSlug ?? 'default'
  const appName = config?.appName ?? 'Default Workspace'

  // First, try to get the existing default team by slug
  const existingTeam = await getTeamBySlug(event, defaultTeamSlug)
  if (existingTeam) {
    return existingTeam
  }

  // Team doesn't exist - create it using direct DB access
  // (We're in request context, so database is available)
  const db = useDB()

  const now = new Date().toISOString()
  const orgId = crypto.randomUUID()

  try {
    // Use isDefault column (Task 6.2) instead of metadata
    await db.run(sql`
      INSERT INTO organization (id, name, slug, isDefault, personal, createdAt)
      VALUES (${orgId}, ${appName}, ${defaultTeamSlug}, 1, 0, ${now})
    `)
    console.log(`[crouton/auth] Created default organization "${appName}" (slug: ${defaultTeamSlug})`)
  } catch (error: unknown) {
    // Handle race condition - if another request created it, fetch it
    const existingAfterRace = await getTeamBySlug(event, defaultTeamSlug)
    if (existingAfterRace) {
      return existingAfterRace
    }
    // Re-throw if it's a different error
    throw error
  }

  // Fetch and return the created team
  const newTeam = await getTeamBySlug(event, defaultTeamSlug)
  if (!newTeam) {
    throw new Error('[crouton/auth] Failed to create default organization')
  }

  return newTeam
}

/**
 * Create personal workspace for user
 *
 * Used in personal mode when user signs up.
 * Called by Better Auth's afterSignUp hook.
 *
 * @param event - H3 event (needed for auth instance)
 * @param userId - User ID
 * @param userName - User name (for workspace name)
 * @returns The created personal workspace
 */
export async function createPersonalWorkspace(event: H3Event, userId: string, userName: string): Promise<Team> {
  try {
    const auth = useServerAuth(event)
    const api = auth.api as unknown as OrganizationApi

    // Create organization with personal flag
    const response = await api.createOrganization({
      body: {
        name: `${userName}'s Workspace`,
        slug: userId, // Use userId as slug for personal workspaces
        metadata: JSON.stringify({
          personal: true,
          ownerId: userId
        })
      },
      headers: event.headers
    })

    if (!response) {
      throw new Error('Failed to create personal workspace')
    }

    // Set as active organization for the user
    await api.setActiveOrganization({
      body: { organizationId: response.id },
      headers: event.headers
    })

    return mapOrganizationToTeam(response)
  } catch (error) {
    console.error('[crouton/auth] createPersonalWorkspace error:', error)
    throw error
  }
}

/**
 * Check if user can create more teams
 *
 * @param event - H3 event (needed for auth instance)
 * @param userId - User ID
 * @returns Whether user can create another team
 */
export async function canUserCreateTeam(event: H3Event, userId: string, _userId?: string): Promise<boolean> {
  const config = useRuntimeConfig().public.crouton?.auth as CroutonAuthConfig | undefined

  // Check if team creation is allowed
  if (config?.teams?.allowCreate === false) {
    return false
  }

  // Get user's current teams
  const teams = await getUserTeams(event)
  const limit = config?.teams?.limit ?? 0 // 0 = unlimited

  // If limit is 0 (unlimited), always allow
  if (limit === 0) {
    return true
  }

  return teams.length < limit
}

// ============================================================================
// Role-Based Access Control
// ============================================================================

/**
 * Require user to have specific role in team
 *
 * @param event - H3 event
 * @param requiredRole - Minimum required role (owner > admin > member)
 * @returns Team context if authorized
 * @throws 403 if user doesn't have required role
 */
export async function requireTeamRole(
  event: H3Event,
  requiredRole: 'owner' | 'admin' | 'member'
): Promise<TeamContext> {
  const context = await resolveTeamAndCheckMembership(event)

  const roleHierarchy = { owner: 3, admin: 2, member: 1 }
  const userRoleLevel = roleHierarchy[context.membership.role] ?? 0
  const requiredRoleLevel = roleHierarchy[requiredRole]

  if (userRoleLevel < requiredRoleLevel) {
    throw createError({
      status: 403,
      message: `Requires ${requiredRole} role or higher`
    })
  }

  return context
}

/**
 * Require user to be team admin (admin or owner)
 */
export async function requireTeamAdmin(event: H3Event): Promise<TeamContext> {
  return requireTeamRole(event, 'admin')
}

/**
 * Require user to be team owner
 */
export async function requireTeamOwner(event: H3Event): Promise<TeamContext> {
  return requireTeamRole(event, 'owner')
}

// ============================================================================
// Direct Database Access (No Event Context)
// ============================================================================

/**
 * Get organization membership directly from database
 *
 * Used when H3 event context is not available (e.g., Better Auth hooks like
 * authorizeReference in the Stripe billing plugin).
 *
 * @param organizationId - Organization/team ID
 * @param userId - User ID
 * @returns Membership with role, or null if not a member
 */
export async function getOrganizationMembershipDirect(
  organizationId: string,
  userId: string
): Promise<{ role: 'owner' | 'admin' | 'member' } | null> {
  const db = useDB()

  const result = await db
    .select({ role: memberTable.role })
    .from(memberTable)
    .where(and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, userId)
    ))
    .limit(1)

  const row = result[0]
  if (!row) return null
  return { role: row.role as 'owner' | 'admin' | 'member' }
}

// ============================================================================
// Helper Functions
// ============================================================================
// mapOrganizationToTeam is imported from ../../shared/utils/auth
