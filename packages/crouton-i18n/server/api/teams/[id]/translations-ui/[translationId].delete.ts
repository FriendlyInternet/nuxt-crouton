import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

/**
 * DELETE /api/teams/[id]/translations-ui/[translationId]
 * Delete a team-specific translation override (reverts to system translation)
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


  // Verify the translation belongs to this team and capture beforeData
  const beforeData = await verifyTeamTranslation(translationId, team.id)

  const result = await deleteTranslation(translationId)

  // Emit hook for event tracking (non-blocking)
  try {
    await useNuxtApp().hooks.callHook('crouton:mutation', {
      operation: 'delete',
      collection: 'translationsUi',
      itemId: translationId,
      beforeData: beforeData as Record<string, unknown>
    })
  } catch {
    // Non-critical: hook may not be available in all server contexts
  }

  return result
})
