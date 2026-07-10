/**
 * PATCH /api/teams/[id]/settings/theme
 *
 * Update team theme settings.
 * Requires team admin or owner role.
 */
import { z } from 'zod'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { useDB, eq } from '@fyit/crouton-auth/server/utils/database'
import { teamSettings, type TeamThemeSettings } from '@fyit/crouton-auth/server/database/schema/auth'

// Validation schema for theme settings
const themeSettingsSchema = z.object({
  // Any theme slug ('custom' + whatever crouton-themes ships). Kept
  // deliberately loose so adding a theme never needs a crouton-core change
  // (#1387 — the old enum 400'd every post-#1303 preset save).
  preset: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
  primary: z.enum([
    'red', 'orange', 'amber', 'yellow', 'lime', 'green',
    'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo',
    'violet', 'purple', 'fuchsia', 'pink', 'rose'
  ]).optional(),
  neutral: z.enum(['slate', 'gray', 'zinc', 'neutral', 'stone']).optional(),
  radius: z.union([
    z.literal(0),
    z.literal(0.125),
    z.literal(0.25),
    z.literal(0.375),
    z.literal(0.5)
  ]).optional(),
  allowUserThemes: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  // Require admin or owner role
  const { team } = await requireTeamAdmin(event)

  // Validate request body
  const body = await readBody(event)
  const result = themeSettingsSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid theme settings',
      message: result.error.issues.map(i => i.message).join(', ')
    })
  }

  const themeData: TeamThemeSettings = result.data

  // Get existing settings or create new
  const db = useDB()
  const existing = await db
    .select()
    .from(teamSettings)
    .where(eq(teamSettings.teamId, team.id))
    .limit(1)

  if (existing.length > 0) {
    // Update existing record
    await db
      .update(teamSettings)
      .set({
        themeSettings: themeData,
        updatedAt: new Date()
      })
      .where(eq(teamSettings.teamId, team.id))
  } else {
    // Insert new record
    await db.insert(teamSettings).values({
      teamId: team.id,
      themeSettings: themeData
    })
  }

  return themeData
})
