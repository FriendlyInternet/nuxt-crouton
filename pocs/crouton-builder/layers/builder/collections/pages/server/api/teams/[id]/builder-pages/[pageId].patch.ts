// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateBuilderPage } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  title: z.string().min(1, 'title is required'),
  slug: z.string().min(1, 'slug is required'),
  isHome: z.boolean().optional(),
  status: z.string().min(1, 'status is required'),
  showInNavigation: z.boolean().optional(),
  board: z.record(z.string(), z.any()).nullish(),
  parentId: z.string().nullable().optional()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { pageId } = getRouterParams(event)
  if (!pageId) {
    throw createError({ status: 400, statusText: 'Missing page ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // Only include fields that were actually sent in the request
  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      updates[key] = value
    }
  }

  const dbTimer = timing.start('db')
  const result = await updateBuilderPage(pageId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})