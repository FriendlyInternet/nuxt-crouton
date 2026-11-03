/**
 * GET /api/teams/[id]/settings/site
 *
 * Get team site settings.
 * Public endpoint — needed by domain resolver middleware
 * to check if public site is enabled.
 */
import { useDB, eq } from '@fyit/crouton-auth/server/utils/database'
import { teamSettings, organization } from '@fyit/crouton-auth/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const teamParam = getRouterParam(event, 'id')
  if (!teamParam) {
    throw createError({ status: 400, statusText: 'Team ID or slug is required' })
  }

  const db = useDB()

  // Resolve team by ID or slug
  const team = await db
    .select({ id: organization.id, logo: organization.logo })
    .from(organization)
    .where(eq(organization.slug, teamParam))
    .limit(1)
    .then((rows: any[]) => rows[0])
    || await db
      .select({ id: organization.id, logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, teamParam))
      .limit(1)
      .then((rows: any[]) => rows[0])

  if (!team) {
    throw createError({ status: 404, statusText: 'Team not found' })
  }

  // Get team settings from database
  const settings = await db
    .select({
      siteSettings: teamSettings.siteSettings
    })
    .from(teamSettings)
    .where(eq(teamSettings.teamId, team.id))
    .limit(1)

  // Site settings (or {}) plus the team logo, so public pages can show it
  // without a separate request (#2259). Read-only here — not part of siteSettings.
  return { ...(settings[0]?.siteSettings ?? {}), teamLogo: team.logo ?? null }
})
