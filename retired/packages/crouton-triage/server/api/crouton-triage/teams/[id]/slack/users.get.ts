/**
 * Fetch Slack users from workspace
 *
 * GET /api/slack/users?slackToken=xoxb-xxx&teamId=xxx
 *
 * Returns list of users from a Slack workspace for use in user mapping dropdowns.
 * Requires a Slack Bot token with users:read scope.
 *
 * Edge-compatible version using fetch instead of @slack/web-api SDK.
 */

interface SlackUser {
  id: string
  name: string
  email: string | null
  avatar: string | null
  realName: string | null
}

interface SlackApiResponse {
  ok: boolean
  error?: string
  members?: Array<{
    id: string
    name: string
    real_name?: string
    deleted?: boolean
    is_bot?: boolean
    is_app_user?: boolean
    profile?: {
      email?: string
      image_48?: string
      real_name?: string
    }
  }>
  response_metadata?: {
    next_cursor?: string
  }
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  try {
    // Get parameters — teamId comes from the route path, not the query string
    const query = getQuery(event)
    let slackToken = query.slackToken as string
    const teamId = getRouterParam(event, 'id') as string
    const accountId = query.accountId as string

    if (!teamId) {
      throw createError({
        status: 422,
        statusText: 'Missing required parameter: teamId'
      })
    }

    // Resolve token from account if accountId provided
    if (accountId && !slackToken) {
      const { resolveAccountToken } = await import('../../../../../utils/tokenResolver')
      slackToken = await resolveAccountToken(accountId, teamId)
    }

    // Validate required parameters
    if (!slackToken) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Missing required parameter: slackToken or accountId'
      })
    }

    // Validate token format (Slack bot tokens start with 'xoxb-')
    if (!slackToken.startsWith('xoxb-')) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Invalid Slack token format. Token must be a bot token starting with "xoxb-"'
      })
    }

    // Fetch all users from workspace using cursor-based pagination
    const allUsers: SlackUser[] = []
    let cursor: string | undefined

    do {
      // Build URL with cursor for pagination
      // Note: don't pass `team_id` — that's only needed for Enterprise Grid org tokens.
      // Workspace bot tokens (xoxb-) are already scoped to a single workspace.
      const url = new URL('https://slack.com/api/users.list')
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }

      const response = await $fetch<SlackApiResponse>(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json'
        }
      })

      // Check for Slack API errors
      if (!response.ok) {
        logger.error('[Slack Users] API error:', response.error)

        // Handle specific Slack errors
        if (response.error === 'invalid_auth' || response.error === 'not_authed') {
          throw createError({
            statusCode: 401,
            statusMessage: 'Invalid Slack token or insufficient permissions'
          })
        }

        if (response.error === 'ratelimited') {
          throw createError({
            statusCode: 429,
            statusMessage: 'Slack API rate limit exceeded. Please try again later.'
          })
        }

        if (response.error === 'missing_scope') {
          throw createError({
            statusCode: 403,
            statusMessage: 'Slack token missing required scope: users:read'
          })
        }

        throw createError({
          statusCode: 400,
          statusMessage: `Slack API error: ${response.error}`
        })
      }

      // Debug: Log response info
      logger.debug(`[Slack Users] Raw API Response members count: ${response.members?.length || 0}`)
      logger.debug(`[Slack Users] Has next cursor: ${!!response.response_metadata?.next_cursor}`)

      // Transform and filter users (exclude bots and deleted users)
      const pageUsers = (response.members || [])
        .filter(member => !member.is_bot && !member.is_app_user && !member.deleted)
        .map(member => ({
          id: member.id,
          name: member.name,
          email: member.profile?.email || null,
          avatar: member.profile?.image_48 || null,
          realName: member.real_name || member.profile?.real_name || null
        }))

      allUsers.push(...pageUsers)

      // Get next cursor for pagination
      cursor = response.response_metadata?.next_cursor || undefined
    } while (cursor)

    // Debug: Log final results
    logger.debug(`[Slack Users] Total users fetched: ${allUsers.length} for team ${teamId}`)

    return {
      success: true,
      users: allUsers,
      total: allUsers.length
    }
  } catch (error: any) {
    logger.error('[Slack Users] Error:', error)

    // Pass through already formatted errors
    if (error.statusCode) {
      throw error
    }

    // Generic error
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch Slack users'
    })
  }
})
