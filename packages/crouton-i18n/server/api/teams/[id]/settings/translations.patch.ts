import { eq } from 'drizzle-orm'
import { teamSettings } from '@fyit/crouton-core/server/database/schema/teamSettings'
import { nanoid } from 'nanoid'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { id: routeTeamId } = getRouterParams(event)
  if (!routeTeamId) {
    throw createError({
      status: 400,
      statusText: 'Team ID is required'
    })
  }
  // Resolves the team (id or slug), checks membership, then 403 unless the
  // member may `translations:manage` (owner/admin by default). Replaces a call
  // to an undefined helper that made every request a 500 (#4108).
  const { team } = await requireCan(event, 'translations:manage')
  const teamId = team.id
  const body = await readBody(event)

  // Validate the translations structure
  if (body.translations && typeof body.translations !== 'object') {
    throw createError({
      status: 400,
      statusText: 'Invalid translations format'
    })
  }

  const db = useDB()

  // Check if settings exist
  const existingSettings = await db
    .select()
    .from(teamSettings)
    .where(eq(teamSettings.teamId as any, teamId))
    .get()

  if (existingSettings) {
    // Update existing settings
    await db
      .update(teamSettings)
      .set({
        translations: body.translations,
        updatedAt: new Date()
      } as any)
      .where(eq(teamSettings.teamId as any, teamId))
      .run()
  } else {
    // Create new settings
    await db
      .insert(teamSettings)
      .values({
        id: nanoid(),
        teamId,
        translations: body.translations,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)
      .run()
  }

  return {
    success: true,
    message: 'Translations updated successfully'
  }
})
