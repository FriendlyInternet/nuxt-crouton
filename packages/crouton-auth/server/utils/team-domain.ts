/**
 * The shared opening of every `/api/teams/[id]/domains/[domainId]/*` route:
 * read the domain id (400 if missing), run the route's permission guard, then
 * load the domain — scoped to the caller's team — or answer 404.
 *
 * The guard is passed in rather than called here so each route still states
 * the action it asks, `requireCan(event, '<action>')`, in its own source
 * (route-actions.test.ts reads that, #4108).
 *
 * Uses Nitro's auto-imported `getRouterParam` / `createError`, like the routes.
 */
import type { H3Event } from 'h3'
import type { TeamContext } from './team'
import { useDB, tables, eq, and } from './database'

export async function requireTeamDomain(event: H3Event, guard: () => Promise<TeamContext>) {
  const domainId = getRouterParam(event, 'domainId')
  if (!domainId) {
    throw createError({
      status: 400,
      statusText: 'Domain ID is required'
    })
  }

  const { team } = await guard()

  const db = useDB()

  const domain = await db
    .select()
    .from(tables.domain)
    .where(and(eq(tables.domain.id, domainId), eq(tables.domain.organizationId, team.id)))
    .get()

  if (!domain) {
    throw createError({
      status: 404,
      statusText: 'Domain not found'
    })
  }

  return { db, team, domain, domainId }
}
