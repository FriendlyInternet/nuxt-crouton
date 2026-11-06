/**
 * Shared Auth Utilities
 *
 * Pure mapping helpers shared between client-side composables and
 * server-side utilities. No Nuxt/H3 dependencies allowed here.
 */
import type { Team } from '../../types/auth'

/**
 * Raw Better Auth / SQLite organization shape.
 *
 * SQLite stores booleans as 0/1 integers, so `personal` and `isDefault`
 * accept both `boolean` and `number` to handle both DB and in-memory values.
 */
export interface RawOrganization {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: string | Record<string, unknown> | null
  personal?: boolean | number | null
  isDefault?: boolean | number | null
  ownerId?: string | null
  createdAt: string | Date
}

/**
 * Map a Better Auth organization response to the canonical Team type.
 *
 * Handles SQLite's 0/1 boolean representation and coerces string dates
 * to Date objects.
 */
export function mapOrganizationToTeam(org: RawOrganization): Team {
  // SQLite returns 0/1 for booleans, so check for truthy value
  const isPersonal = org.personal === true || org.personal === 1
  const isDefaultOrg = org.isDefault === true || org.isDefault === 1

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo ?? null,
    metadata: {},
    personal: isPersonal,
    isDefault: isDefaultOrg,
    ownerId: org.ownerId ?? undefined,
    createdAt: new Date(org.createdAt),
    updatedAt: new Date(org.createdAt)
  }
}

/**
 * The single "may create a team" rule for `teams.allowCreate: 'superAdmin'`:
 * a site admin (`role === 'admin'`) or a super admin (`superAdmin === true`).
 * Used by both the server (Better Auth) and the client (useTeam).
 */
export function isSuperAdminUser(
  user: { role?: string | null, superAdmin?: boolean | null } | null | undefined
): boolean {
  return user?.role === 'admin' || user?.superAdmin === true
}

/**
 * Where a signed-in user belongs (#3130) — route by who you are, never hide buttons.
 * team member → their team admin; may create teams → create-team; otherwise the
 * "not in a team yet — ask for an invite" page.
 */
export function resolveTeamEntryRoute(opts: { teamSlug?: string | null, canCreateTeam: boolean }): string {
  if (opts.teamSlug) return `/admin/${opts.teamSlug}`
  return opts.canCreateTeam ? '/onboarding/create-team' : '/onboarding/no-team'
}

/** Opening create-team directly without permission → bounce to /admin, which routes by role. */
export function resolveCreateTeamGuard(canCreateTeam: boolean): string | null {
  return canCreateTeam ? null : '/admin'
}
