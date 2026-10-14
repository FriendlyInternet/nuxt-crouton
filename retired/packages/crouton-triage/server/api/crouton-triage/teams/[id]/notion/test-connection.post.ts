/**
 * Test Notion Connection Endpoint
 *
 * Tests if a Notion integration token is valid by calling the Notion API.
 * Used by the FlowBuilder UI to verify Notion input configuration.
 *
 * **Endpoint:** POST /api/notion/test-connection
 *
 * **Request:**
 * ```json
 * {
 *   "notionToken": "secret_..."
 * }
 * ```
 *
 * **Response:**
 * ```json
 * {
 *   "success": true,
 *   "bot": {
 *     "id": "...",
 *     "name": "My Integration",
 *     "owner": { ... }
 *   }
 * }
 * ```
 */

import { z } from 'zod'

const requestSchema = z.object({
  notionToken: z.string().optional(),
  accountId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  try {
    // 1. Validate request
    const body = await readBody(event)
    const parsed = requestSchema.parse(body)
    let notionToken = parsed.notionToken

    // Resolve token from account if accountId provided
    if (parsed.accountId && !notionToken) {
      const teamId = getRouterParam(event, 'id')
      if (teamId) {
        const { resolveAccountToken } = await import('../../../../../utils/tokenResolver')
        notionToken = await resolveAccountToken(parsed.accountId, teamId)
      }
    }

    if (!notionToken) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Missing required parameter: notionToken or accountId',
      })
    }

    // 2. Call Notion API to verify token
    const response = await $fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    })

    // 3. Return bot info
    return {
      success: true,
      bot: response
    }
  } catch (error: any) {
    // Handle Notion API errors
    if (error.response?.status === 401) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid Notion token',
        data: { error: 'The provided Notion token is invalid or has been revoked.' }
      })
    }

    if (error.response?.status === 403) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Insufficient permissions',
        data: { error: 'The integration does not have sufficient permissions.' }
      })
    }

    // Handle Zod validation errors
    if (error.name === 'ZodError') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request',
        data: { error: error.errors[0]?.message || 'Invalid request body' }
      })
    }

    // Generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Connection test failed',
      data: { error: error.message || 'Failed to connect to Notion' }
    })
  }
})
