/**
 * Fetch Notion users from workspace
 *
 * GET /api/notion/users?notionToken=secret_xxx&teamId=xxx
 *
 * Returns list of users from a Notion workspace for use in user mapping dropdowns.
 * Requires a Notion integration token with access to the workspace.
 *
 * Edge-compatible version using fetch instead of @notionhq/client SDK.
 */

import { logger } from '../../../../../utils/logger'

const NOTION_API_VERSION = '2022-06-28'

export default defineEventHandler(async (event): Promise<any> => {
  await requireAuth(event)


  try {
    // Get parameters — teamId comes from the route path, not the query string
    const query = getQuery(event)
    let notionToken = query.notionToken as string
    const teamId = getRouterParam(event, 'id') as string
    const accountId = query.accountId as string

    if (!teamId) {
      throw createError({
        status: 422,
        statusText: 'Missing required parameter: teamId'
      })
    }

    // Resolve token from account if accountId provided
    if (accountId && !notionToken) {
      const { resolveAccountToken } = await import('../../../../../utils/tokenResolver')
      notionToken = await resolveAccountToken(accountId, teamId)
    }

    // Validate required parameters
    if (!notionToken) {
      throw createError({
        status: 422,
        statusText: 'Missing required parameter: notionToken or accountId'
      })
    }

    // Validate token format (Notion tokens can be internal 'secret_*' or public 'ntn_*')
    if (!notionToken.startsWith('secret_') && !notionToken.startsWith('ntn_')) {
      throw createError({
        status: 422,
        statusText: 'Invalid Notion token format. Token must start with "secret_" (internal) or "ntn_" (public)'
      })
    }

    // Fetch all users from workspace using edge-compatible fetch
    const response = await $fetch<any>('https://api.notion.com/v1/users', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    })

    // Debug: Log full response
    logger.debug('[Notion Users] Raw API Response', { response })
    logger.debug('[Notion Users] API results info', { totalResults: response.results?.length || 0, hasNextCursor: !!response.next_cursor })

    // Transform to simpler format for frontend
    const users = response.results.map((user: any) => ({
      id: user.id,
      name: user.name || 'Unknown',
      email: user.person?.email || user.bot?.owner?.user?.person?.email || null,
      type: user.type, // 'person' or 'bot'
      avatarUrl: user.avatar_url || null
    }))

    // Debug: Log user types breakdown
    const personCount = users.filter((u: any) => u.type === 'person').length
    const botCount = users.filter((u: any) => u.type === 'bot').length
    logger.debug('[Notion Users] User type breakdown', { personCount, botCount })
    logger.debug('[Notion Users] All users', { users: users.map((u: any) => ({ name: u.name, type: u.type, email: u.email })) })

    // Filter out bots if requested
    const includeBots = query.includeBots === 'true'
    const filteredUsers = includeBots
      ? users
      : users.filter((u: any) => u.type === 'person')

    logger.debug('[Notion Users] After filtering', { returning: filteredUsers.length, teamId, includeBots })

    return {
      success: true,
      users: filteredUsers,
      total: filteredUsers.length
    }
  } catch (error: any) {
    logger.error('[Notion Users] Error', error)

    // Handle Notion API errors
    if (error.code === 'unauthorized') {
      throw createError({
        status: 401,
        statusText: 'Invalid Notion token or insufficient permissions'
      })
    }

    if (error.code === 'rate_limited') {
      throw createError({
        status: 429,
        statusText: 'Notion API rate limit exceeded. Please try again later.'
      })
    }

    // Pass through already formatted errors
    if (error.statusCode) {
      throw error
    }

    // Generic error
    throw createError({
      status: 500,
      statusText: error.message || 'Failed to fetch Notion users'
    })
  }
})
