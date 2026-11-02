import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

/**
 * PATCH /api/teams/[id]/translations-ui/[translationId]
 * Update a team-specific translation override
 *
 * Body:
 * - values: Record<string, string> (optional)
 * - description: string (optional)
 */
export default defineEventHandler(async (event) => {
  const translationId = getRouterParam(event, 'translationId')

  if (!translationId) {
    throw createError({
      status: 400,
      statusText: 'Translation ID is required'
    })
  }

  // Get team and verify membership
  const { team, user } = await requireTeamAdmin(event)


  const body = await readBody(event)

  // Verify the translation belongs to this team and capture beforeData
  const beforeData = await verifyTeamTranslation(translationId, team.id)

  // Update translation - for teams, only allow updating values and description
  const updateData = {
    ...(body.values && { values: body.values }),
    ...(body.description !== undefined && { description: body.description })
    // Don't allow teams to update category, keyPath, or isOverrideable
  }

  const result = await updateTranslation(translationId, updateData)

  // Emit hook for event tracking (non-blocking)
  try {
    await useNuxtApp().hooks.callHook('crouton:mutation', {
      operation: 'update',
      collection: 'translationsUi',
      itemId: translationId,
      updates: updateData as Record<string, unknown>,
      result,
      beforeData: beforeData as Record<string, unknown>
    })
  } catch {
    // Non-critical: hook may not be available in all server contexts
  }

  return result
})
