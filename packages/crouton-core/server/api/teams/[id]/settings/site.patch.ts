/**
 * PATCH /api/teams/[id]/settings/site
 *
 * Update team site settings.
 * Requires the `site:manage` action (owner/admin by default).
 */
import { z } from 'zod'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { useDB, eq } from '@fyit/crouton-auth/server/utils/database'
import { teamSettings, type TeamSiteSettings } from '@fyit/crouton-auth/server/database/schema/auth'

// Validation schema for site settings
const siteSettingsSchema = z.object({
  publicSiteEnabled: z.boolean().optional(),
  favicon: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  newsletterUrl: z.string().url().optional().or(z.literal('')),
  calendarUrl: z.string().url().optional().or(z.literal('')),
  registrationUrl: z.string().url().optional().or(z.literal('')),
  socialLinks: z.object({
    facebook: z.string().optional(),
    instagram: z.string().optional(),
    youtube: z.string().optional(),
    linkedin: z.string().optional(),
    twitter: z.string().optional(),
    tiktok: z.string().optional()
  }).optional()
})

export default defineEventHandler(async (event) => {
  // Require the site:manage action
  const { team } = await requireCan(event, 'site:manage')

  // Validate request body
  const body = await readBody(event)
  const result = siteSettingsSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid site settings',
      message: result.error.issues.map(i => i.message).join(', ')
    })
  }

  const patch = result.data

  // Get existing settings or create new
  const db = useDB()
  const existing = await db
    .select()
    .from(teamSettings)
    .where(eq(teamSettings.teamId, team.id))
    .limit(1)

  // Merge with existing site settings so PATCH doesn't wipe unrelated fields
  const currentSite = (existing[0]?.siteSettings as TeamSiteSettings | null) ?? {}
  const siteData: TeamSiteSettings = { ...currentSite, ...patch }

  if (existing.length > 0) {
    // Update existing record
    await db
      .update(teamSettings)
      .set({
        siteSettings: siteData,
        updatedAt: new Date()
      })
      .where(eq(teamSettings.teamId, team.id))
  } else {
    // Insert new record
    await db.insert(teamSettings).values({
      teamId: team.id,
      siteSettings: siteData
    })
  }

  return siteData
})
