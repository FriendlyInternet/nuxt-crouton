// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createPagesPage, getPagesPagesByIds } from '../../../../database/queries'
import { nanoid } from 'nanoid'
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
  )
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema) — we generate the id for path calculation
  const dataWithoutId = body

  // Generate ID upfront for correct path calculation
  const recordId = nanoid()

  // Calculate path based on parentId
  let path = `/${recordId}/`
  let depth = 0

  if (dataWithoutId.parentId) {
    const [parent] = await getPagesPagesByIds(team.id, [dataWithoutId.parentId])
    if (parent) {
      path = `${parent.path}${recordId}/`
      depth = (parent.depth || 0) + 1
    }
  }

  // Convert date string to Date object
  if (dataWithoutId.publishedAt) {
    dataWithoutId.publishedAt = new Date(dataWithoutId.publishedAt)
  }
  const dbTimer = timing.start('db')
  const result = await createPagesPage({
    ...dataWithoutId,
    id: recordId,
    path,
    depth,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})