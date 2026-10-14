/**
 * Create a new select property in a Notion database
 *
 * POST /api/teams/[id]/notion/database/[databaseId]/property
 *
 * Body:
 * {
 *   accountId?: string,
 *   notionToken?: string,
 *   propertyName: string,
 * }
 */

import { z } from 'zod'

const NOTION_API_VERSION = '2022-06-28'

const requestSchema = z.object({
  accountId: z.string().optional(),
  notionToken: z.string().optional(),
  propertyName: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const teamId = getRouterParam(event, 'id')
  const databaseId = getRouterParam(event, 'databaseId')

  if (!teamId) {
    throw createError({ status: 422, statusText: 'Missing team ID' })
  }
  if (!databaseId) {
    throw createError({ status: 422, statusText: 'Missing databaseId' })
  }

  const body = await readBody(event)
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid request',
      data: { errors: parsed.error.flatten().fieldErrors },
    })
  }

  const { accountId, notionToken, propertyName } = parsed.data

  const token = await resolveNotionToken({ accountId, notionToken, teamId })

  try {
    await $fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: {
        properties: {
          [propertyName]: { select: { options: [] } },
        },
      },
    })

    return { success: true, propertyName, type: 'select' }
  }
  catch (error: any) {
    const message = error.data?.message || error.message || 'Failed to create property'
    console.error(`[categorize] Failed to create property "${propertyName}":`, message)
    throw createError({ status: 500, statusText: message })
  }
})
