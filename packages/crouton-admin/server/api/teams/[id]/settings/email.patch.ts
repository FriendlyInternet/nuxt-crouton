/**
 * PATCH /api/teams/[id]/settings/email
 *
 * Update team email template overrides.
 * Requires the `team:manage` action (owner/admin by default).
 */
import { z } from 'zod'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { useDB, eq } from '@fyit/crouton-auth/server/utils/database'
import { teamSettings, type TeamEmailSettings } from '@fyit/crouton-auth/server/database/schema/auth'

const emailOverridesSchema = z.object({
  subject: z.string().max(200).optional(),
  greeting: z.string().max(500).optional(),
  body: z.string().max(2000).optional(),
  buttonText: z.string().max(100).optional(),
  footer: z.string().max(1000).optional()
}).strict()

const emailSettingsSchema = z.object({
  'password-reset': emailOverridesSchema.optional(),
  'verification': emailOverridesSchema.optional(),
  'magic-link': emailOverridesSchema.optional(),
  'team-invite': emailOverridesSchema.optional(),
  'welcome': emailOverridesSchema.optional()
}).strict()

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'team:manage')

  const body = await readBody(event)
  const result = emailSettingsSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid email settings',
      message: result.error.issues.map(i => i.message).join(', ')
    })
  }

  const emailData: TeamEmailSettings = result.data

  const db = useDB()
  const existing = await db
    .select()
    .from(teamSettings)
    .where(eq(teamSettings.teamId, team.id))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(teamSettings)
      .set({
        emailSettings: emailData,
        updatedAt: new Date()
      })
      .where(eq(teamSettings.teamId, team.id))
  } else {
    await db.insert(teamSettings).values({
      teamId: team.id,
      emailSettings: emailData
    })
  }

  return emailData
})
