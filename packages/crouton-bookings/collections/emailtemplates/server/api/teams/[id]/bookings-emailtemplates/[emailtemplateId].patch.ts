// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { updateBookingsEmailtemplate, getBookingsEmailtemplatesByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377). `locale` is a transient merge hint, not a column.
const bodySchema = z.object({
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  fromEmail: z.string(),
  triggerType: z.string(),
  recipientType: z.string(),
  isActive: z.boolean().nullish(),
  daysOffset: z.number().int().nullish(),
  locationId: z.string().nullish(),
  translations: z.record(z.string(), z.object({
    name: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional()
  })).nullish()
}).partial().extend({ locale: z.string().optional() }).strip()

export default defineEventHandler(async (event) => {
  const { emailtemplateId } = getRouterParams(event)
  if (!emailtemplateId) {
    throw createError({ status: 400, statusText: 'Missing emailtemplate ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  // Handle translation updates properly
  if (body.translations && body.locale) {
    const [existing] = await getBookingsEmailtemplatesByIds(team.id, [emailtemplateId]) as any[]
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

  return await updateBookingsEmailtemplate(emailtemplateId, team.id, user.id, {
    name: body.name,
    subject: body.subject,
    body: body.body,
    fromEmail: body.fromEmail,
    triggerType: body.triggerType,
    recipientType: body.recipientType,
    isActive: body.isActive ?? undefined,
    daysOffset: body.daysOffset ?? undefined,
    locationId: body.locationId ?? undefined,
    translations: body.translations ?? undefined
  }, { role: membership.role })
})
