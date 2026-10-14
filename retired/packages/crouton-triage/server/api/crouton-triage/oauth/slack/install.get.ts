/**
 * Slack OAuth Install Endpoint
 *
 * Initiates the Slack OAuth 2.0 authorization flow.
 * Redirects users to Slack's authorization page where they can install the app.
 *
 * Flow:
 * 1. Generate secure random state token (CSRF protection)
 * 2. Store state token with expiration (5 minutes)
 * 3. Build Slack authorization URL with required scopes
 * 4. Redirect user to Slack for authorization
 *
 * Required Environment Variables:
 * - SLACK_CLIENT_ID: Your Slack app's client ID
 * - SLACK_CLIENT_SECRET: Your Slack app's client secret
 * - BASE_URL: Your application's base URL (for redirect_uri)
 *
 * @see https://api.slack.com/authentication/oauth-v2
 */

import { randomBytes } from 'node:crypto'
import { kv } from 'hub:kv'

/**
 * Required Slack OAuth scopes for the bot
 *
 * Scopes needed:
 * - channels:history: Read messages in public channels
 * - channels:read: View basic channel info
 * - chat:write: Post messages as the bot
 * - reactions:write: Add emoji reactions to messages
 * - app_mentions:read: Receive @mentions of the bot
 * - im:history: Read direct messages
 * - im:read: View direct message info
 * - im:write: Send direct messages
 * - mpim:history: Read group direct messages
 * - mpim:read: View group direct message info
 * - mpim:write: Send group direct messages
 * - users:read: List workspace members for user mapping
 * - users:read.email: Get member emails for auto-matching with Notion users
 */
/**
 * Parse Slack workspace input into a hostname for the OAuth URL.
 *
 * Accepts:
 * - Full URL: "https://myteam.slack.com" → "myteam.slack.com"
 * - Domain: "myteam.slack.com" → "myteam.slack.com"
 * - Subdomain only: "myteam" → "myteam.slack.com"
 * - Team ID: "T12345" → "slack.com" (team IDs are passed via query param instead)
 * - undefined/empty → "slack.com" (default)
 */
function parseSlackWorkspace(input?: string): string {
  if (!input?.trim()) return 'slack.com'

  const value = input.trim()

  // Team ID (T-prefixed) — handled via `team` query param, use default host
  if (value.match(/^T[A-Z0-9]+$/)) return 'slack.com'

  // Full URL — extract hostname
  if (value.includes('://')) {
    try {
      const url = new URL(value)
      return url.hostname
    }
    catch {
      return 'slack.com'
    }
  }

  // Already a domain (contains .slack.com)
  if (value.includes('.slack.com')) return value

  // Plain workspace name — append .slack.com
  return `${value}.slack.com`
}

const SLACK_SCOPES = [
  'channels:history',
  'channels:read',
  'chat:write',
  'reactions:write',
  'app_mentions:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'users:read',
  'users:read.email',
].join(',')

export default defineEventHandler(async (event) => {
  try {
    // Get environment variables
    const config = useRuntimeConfig(event)
    const clientId = config.slackClientId || process.env.SLACK_CLIENT_ID
    const baseUrl = config.public.baseUrl || process.env.BASE_URL || 'http://localhost:3000'

    // Validate required configuration
    if (!clientId) {
      throw createError({
        status: 500,
        statusText: 'Slack OAuth not configured: Missing SLACK_CLIENT_ID',
      })
    }

    // Get team ID, flow ID, Slack workspace, and opener origin from query params
    const query = getQuery(event)
    const teamId = (query.teamId as string) || (query.team_id as string) || 'default'
    const flowId = query.flowId as string | undefined
    const openerOrigin = query.openerOrigin as string | undefined
    const slackTeam = query.slackTeam as string | undefined

    // Generate secure random state token (32 bytes = 256 bits)
    const state = randomBytes(32).toString('hex')

    // Store state token with team ID, flow ID, and opener origin in NuxtHub KV
    // TTL of 300 seconds (5 minutes) for automatic cleanup
    await kv.set(`oauth:state:${state}`, {
      teamId,
      flowId, // Optional: if provided, input will be added to this specific flow
      openerOrigin, // For postMessage back to parent window
      createdAt: Date.now(),
    }, {
      ttl: 300, // 5 minutes
    })

    // Build redirect URI (must match what's configured in Slack app settings)
    const redirectUri = `${baseUrl}/api/crouton-triage/oauth/slack/callback`

    // Build Slack authorization URL
    // If a workspace name is provided, use it as subdomain to pre-select that workspace
    const slackHost = parseSlackWorkspace(slackTeam)
    const slackAuthUrl = new URL(`https://${slackHost}/oauth/v2/authorize`)
    slackAuthUrl.searchParams.set('client_id', clientId as any)
    slackAuthUrl.searchParams.set('scope', SLACK_SCOPES)
    slackAuthUrl.searchParams.set('state', state)
    slackAuthUrl.searchParams.set('redirect_uri', redirectUri)

    // If slackTeam looks like a team ID (T-prefixed), also pass as team param
    if (slackTeam?.match(/^T[A-Z0-9]+$/)) {
      slackAuthUrl.searchParams.set('team', slackTeam)
    }

    // Redirect to Slack authorization page
    return sendRedirect(event, slackAuthUrl.toString(), 302)
  }
  catch (error: any) {
    console.error('[OAuth] Failed to initiate Slack OAuth flow:', error?.message, error?.stack)

    // Return detailed error for debugging
    throw createError({
      status: 500,
      statusText: `Failed to initiate Slack authorization: ${error?.message || 'Unknown error'}`,
    })
  }
})

/**
 * Export for testing (KV-based storage doesn't need exports)
 *
 * Note: State is now stored in NuxtHub KV with automatic TTL cleanup.
 * For testing, mock hubKV() calls instead of using exported Map.
 */
