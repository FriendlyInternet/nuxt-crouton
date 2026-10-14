// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updatePagesPage } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { PagesPage } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { pageId } = getRouterParams(event)
  if (!pageId) {
    throw createError({ status: 400, statusText: 'Missing page ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<PagesPage>>(event)

  const dbTimer = timing.start('db')
  const result = await updatePagesPage(pageId, team.id, user.id, {
    title: body.title,
    slug: body.slug,
    pageType: body.pageType,
    content: body.content,
    config: body.config,
    status: body.status,
    visibility: body.visibility,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : body.publishedAt,
    showInNavigation: body.showInNavigation,
    layout: body.layout,
    seoTitle: body.seoTitle,
    seoDescription: body.seoDescription
  }, { role: membership.role })
  dbTimer.end()
  return result
})