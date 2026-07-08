/**
 * Update Notion pages with category assignments
 *
 * POST /api/teams/[id]/notion/database/[databaseId]/categorize
 *
 * Body:
 * {
 *   accountId?: string,          // Connected account ID (preferred)
 *   notionToken?: string,        // Inline token (fallback)
 *   propertyName: string,        // Notion property to update
 *   propertyType?: 'select' | 'status' | 'multi_select',
 *   assignments: [
 *     { pageId: string, category: string }
 *   ]
 * }
 *
 * Updates each page's property with the assigned category name.
 * Rate-limited with 200ms delays between requests.
 */

import { z } from 'zod'

const NOTION_API_VERSION = '2022-06-28'

const requestSchema = z.object({
  accountId: z.string().optional(),
  notionToken: z.string().optional(),
  propertyName: z.string().min(1),
  propertyType: z.enum(['select', 'status', 'multi_select']).default('select'),
  assignments: z.array(z.object({
    pageId: z.string().min(1),
    category: z.string().min(1),
  })).min(1),
})

type CategorizeRequest = z.infer<typeof requestSchema>

interface AssignmentResult {
  pageId: string
  success: boolean
  error?: string
}

async function readCategorizeRequest(event: any): Promise<CategorizeRequest> {
  const body = await readBody(event)
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid request',
      data: { errors: parsed.error.flatten().fieldErrors },
    })
  }

  return parsed.data
}

function buildPropertyValue(propertyType: CategorizeRequest['propertyType'], category: string) {
  return propertyType === 'multi_select'
    ? { multi_select: [{ name: category }] }
    : { [propertyType]: { name: category } }
}

function extractUpdateErrorMessage(error: any): string {
  const notionError = error.data?.message || error.data?.object === 'error' && error.data?.message
  return notionError || error.message || 'Failed to update page'
}

async function applyAssignment(
  token: string,
  propertyName: string,
  propertyType: CategorizeRequest['propertyType'],
  pageId: string,
  category: string,
): Promise<AssignmentResult> {
  try {
    await $fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: {
        properties: {
          [propertyName]: buildPropertyValue(propertyType, category),
        },
      },
    })

    return { pageId, success: true }
  }
  catch (error: any) {
    const errorMessage = extractUpdateErrorMessage(error)
    console.error(`[categorize] Failed to update page ${pageId}:`, errorMessage, error.data || '')
    return {
      pageId,
      success: false,
      error: errorMessage,
    }
  }
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const teamId = getRouterParam(event, 'id')
  if (!teamId) {
    throw createError({ status: 422, statusText: 'Missing team ID' })
  }

  const { accountId, notionToken, propertyName, propertyType, assignments } = await readCategorizeRequest(event)

  const token = await resolveNotionToken({ accountId, notionToken, teamId })

  const results: AssignmentResult[] = []

  for (let i = 0; i < assignments.length; i++) {
    const { pageId, category } = assignments[i]!

    results.push(await applyAssignment(token, propertyName, propertyType, pageId, category))

    // Rate limiting: 200ms between requests
    if (i < assignments.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  return {
    success: failed === 0,
    total: assignments.length,
    succeeded,
    failed,
    results,
  }
})
