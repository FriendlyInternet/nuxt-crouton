import { useNitroApp } from 'nitropack/runtime'
import { requireServerSession } from '@fyit/crouton-auth/server/utils/useServerAuth'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  // Auth check - require authenticated user
  const session = await requireServerSession(event)
  const userId = session.user.id
  const activeTeamId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId

  const { pathname } = await readBody<{ pathname: string }>(event)

  if (!pathname || typeof pathname !== 'string') {
    throw createError({
      status: 400,
      statusText: 'pathname is required'
    })
  }

  // Ownership: own user prefix, or the active team's prefix as team admin
  let decoded = pathname
  try { decoded = decodeURIComponent(pathname) } catch { /* keep raw */ }
  if (decoded.split('/').some(seg => seg === '..' || seg === '.') || pathname.includes('..')) {
    throw createError({ status: 403, statusText: 'Forbidden' })
  }
  if (decoded.startsWith(`users/${userId}/`)) {
    // own file
  } else if (activeTeamId && decoded.startsWith(`teams/${activeTeamId}/`)) {
    await requireTeamAdmin(event)
  } else {
    throw createError({ status: 403, statusText: 'Forbidden' })
  }

  try {
    await blob.delete(pathname)

    const nitroApp = useNitroApp()
    nitroApp.hooks.callHook('crouton:operation', {
      type: 'asset:deleted',
      source: 'crouton-assets',
      userId,
      metadata: { pathname },
    }).catch(() => {})

    return { success: true, pathname }
  } catch (error: unknown) {
    throw createError({
      status: 500,
      statusText: `Failed to delete file: ${(error as Error).message}`
    })
  }
})
