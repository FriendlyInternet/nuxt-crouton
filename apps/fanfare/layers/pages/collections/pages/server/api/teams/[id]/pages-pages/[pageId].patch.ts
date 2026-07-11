// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updatePagesPage, getPagesPagesByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  pageType: z.string().min(1, 'pageType is required'),
  config: z.record(z.string(), z.any()).nullish(),
  status: z.string().min(1, 'status is required'),
  visibility: z.string().min(1, 'visibility is required'),
  publishedAt: z.coerce.date().nullish(),
  showInNavigation: z.boolean().nullish(),
  layout: z.string().nullish(),
  ogImage: z.string().nullish(),
  robots: z.string().nullish(),
  title: z.string().nullish(),
  slug: z.string().nullish(),
  content: z.string().nullish(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  parentId: z.string().nullable().optional(),
  translations: z.record(
    z.string(),
    z.object({
      title: z.string().min(1, 'Title is required'),
      slug: z.string().min(1, 'Slug is required'),
      content: z.string().optional(),
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional()
    })
  ).refine(
    (translations) => translations.nl && translations.nl.title && translations.nl.slug,
    { message: 'Translations for title, slug (nl) are required' }
  ),
  // Transient hint: which locale the translation patch targets (not a column)
  locale: z.string().optional()
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

  // Handle translation updates properly
  if (body.translations && body.locale) {
    const [existing] = await getPagesPagesByIds(team.id, [pageId]) as any[]
    if (existing) {
      body.translations = {
        ...existing.translations,
        [body.locale]: {
          ...existing.translations?.[body.locale],
          ...body.translations[body.locale]
        }
      }
    }
  }

  // Only include fields that were actually sent in the request
  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'locale') continue // transient translation hint, not a column
    if (value !== undefined) {
      updates[key] = value
    }
  }

  const dbTimer = timing.start('db')
  const result = await updatePagesPage(pageId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})