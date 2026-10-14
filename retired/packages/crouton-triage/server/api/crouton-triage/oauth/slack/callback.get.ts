/**
 * Slack OAuth Callback Endpoint
 *
 * Handles the OAuth 2.0 callback from Slack after user authorization.
 * Exchanges the temporary authorization code for an access token.
 *
 * **Flow (Flows Architecture v2):**
 * 1. Verify state parameter (CSRF protection)
 * 2. Extract authorization code from query params
 * 3. Exchange code for access token via oauth.v2.access
 * 4. Check if team already has a flow with Slack input
 * 5. If yes: Add new input to existing flow
 * 6. If no: Create new flow + first input
 * 7. Clean up state token
 * 8. Redirect to success page
 *
 * Required Environment Variables:
 * - SLACK_CLIENT_ID: Your Slack app's client ID
 * - SLACK_CLIENT_SECRET: Your Slack app's client secret
 * - BASE_URL: Your application's base URL
 *
 * @see https://api.slack.com/methods/oauth.v2.access
 */

import { kv } from 'hub:kv'
import { logger } from '../../../../utils/logger'

/**
 * Return an HTML page that sends OAuth result back to the opener via postMessage,
 * then closes the popup. If no opener, shows a simple success/error message.
 */
function oauthResultHtml(data: {
  type: 'oauth-success' | 'oauth-error'
  credentials?: Record<string, any>
  error?: string
  openerOrigin?: string
  provider: string
  status: string
  teamName?: string
}) {
  const message = JSON.stringify({
    type: data.type,
    credentials: data.credentials,
    error: data.error,
    provider: data.provider,
    status: data.status,
  })
  const origin = data.openerOrigin || '*'
  const title = data.type === 'oauth-success'
    ? `${data.teamName || data.provider} connected successfully!`
    : `Connection failed: ${data.error || 'Unknown error'}`

  return `<!DOCTYPE html>
<html><head><title>OAuth - ${data.provider}</title></head>
<body>
<p>${title}</p>
<p>You can close this window.</p>
<script>
  if (window.opener) {
    window.opener.postMessage(${message}, '${origin}');
    window.close();
  }
</script>
</body></html>`
}

/**
 * Slack oauth.v2.access response structure
 */
interface SlackOAuthResponse {
  ok: boolean
  access_token?: string
  token_type?: string
  scope?: string
  bot_user_id?: string
  app_id?: string
  team?: {
    id: string
    name: string
  }
  enterprise?: {
    id: string
    name: string
  }
  authed_user?: {
    id: string
  }
  error?: string
}

export default defineEventHandler(async (event) => {
  try {
    // Get query parameters
    const query = getQuery(event)
    const code = query.code as string
    const state = query.state as string
    const error = query.error as string

    // Handle authorization denial
    if (error) {
      logger.error('[OAuth] User denied authorization', null, { error })
      throw createError({
        status: 403,
        statusText: `Slack authorization denied: ${error}`,
      })
    }

    // Validate required parameters
    if (!code) {
      throw createError({
        status: 400,
        statusText: 'Missing authorization code',
      })
    }

    if (!state) {
      throw createError({
        status: 400,
        statusText: 'Missing state parameter',
      })
    }

    // Verify state token (CSRF protection) using NuxtHub KV
    const stateData = await (kv as any).get(`oauth:state:${state}`) as { teamId: string; flowId?: string; openerOrigin?: string; createdAt: number } | null

    if (!stateData) {
      logger.error('[OAuth] Invalid or expired state token')
      throw createError({
        status: 403,
        statusText: 'Invalid or expired authorization request',
      })
    }

    // Extract team ID, optional flow ID, and opener origin from state
    const { teamId, flowId: requestedFlowId, openerOrigin } = stateData

    // Delete state token (single use) from KV
    await (kv as any).del(`oauth:state:${state}`)

    // Get environment variables
    const config = useRuntimeConfig(event) as any
    const clientId = config.slackClientId || process.env.SLACK_CLIENT_ID
    const clientSecret = config.slackClientSecret || process.env.SLACK_CLIENT_SECRET
    const baseUrl = config.public?.baseUrl || process.env.BASE_URL || 'http://localhost:3000'

    // Validate required configuration
    if (!clientId || !clientSecret) {
      throw createError({
        status: 500,
        statusText: 'Slack OAuth not configured: Missing client credentials',
      })
    }

    // Build redirect URI (must match install.get.ts)
    const redirectUri = `${baseUrl}/api/crouton-triage/oauth/slack/callback`

    logger.debug('[OAuth] Exchanging code for access token', {
      teamId,
      codePrefix: code.substring(0, 10) + '...',
    })

    // Exchange authorization code for access token
    // Use POST with form-encoded body as per Slack API requirements
    const tokenUrl = 'https://slack.com/api/oauth.v2.access'
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      logger.error('[OAuth] Token exchange failed', null, { status: tokenResponse.status, statusText: tokenResponse.statusText })
      throw createError({
        status: 502,
        statusText: 'Failed to exchange authorization code',
      })
    }

    const tokenData = await tokenResponse.json() as SlackOAuthResponse

    if (!tokenData.ok || !tokenData.access_token) {
      logger.error('[OAuth] Token exchange error', null, { error: tokenData.error })
      throw createError({
        status: 502,
        statusText: `Slack OAuth error: ${tokenData.error || 'Unknown error'}`,
      })
    }

    logger.debug('[OAuth] Successfully obtained access token', {
      teamId,
      slackTeamId: tokenData.team?.id,
      slackTeamName: tokenData.team?.name,
      botUserId: tokenData.bot_user_id,
      scopes: tokenData.scope,
    })

    // ============================================================================
    // CREATE/UPDATE FLOW + INPUT
    // ============================================================================
    const slackTeamId = tokenData.team?.id || ''
    const slackTeamName = tokenData.team?.name || 'Slack Workspace'
    const accessToken = tokenData.access_token!

    // Import database and queries
    const { getAllTriageFlows, createTriageFlow } = await import(
      '~~/layers/triage/collections/flows/server/database/queries'
    ) as any
    const { getAllTriageInputs, createTriageInput, updateTriageInput } = await import(
      '~~/layers/triage/collections/inputs/server/database/queries'
    ) as any
    const { getAllTriageAccounts, createTriageAccount, updateTriageAccount } = await import(
      '~~/layers/triage/collections/accounts/server/database/queries'
    ) as any
    const { SYSTEM_USER_ID } = await import('../../../../utils/constants') as any

    // ============================================================================
    // CREATE OR UPDATE CONNECTED ACCOUNT
    // ============================================================================
    // Check if an account already exists for this Slack workspace + team
    const allAccounts = await getAllTriageAccounts(teamId)
    const existingAccount: any = (allAccounts as any[])?.find(
      (a: any) => a.provider === 'slack' && a.providerAccountId === slackTeamId
    )

    let accountId: string

    if (existingAccount) {
      // Re-auth: update the existing account's token
      const encryptedToken = await encryptSecret(accessToken)
      const tokenHint = maskSecret(accessToken)

      await updateTriageAccount(existingAccount.id, teamId, SYSTEM_USER_ID, {
        accessToken: encryptedToken,
        accessTokenHint: tokenHint,
        scopes: tokenData.scope || '',
        status: 'connected',
        lastVerifiedAt: new Date(),
        providerMetadata: {
          ...((existingAccount.providerMetadata as Record<string, any>) || {}),
          slackTeamName,
          botUserId: tokenData.bot_user_id || '',
        },
      })

      accountId = existingAccount.id
      logger.info('[OAuth] Updated existing account', { accountId, slackTeamId })
    } else {
      // New account
      const encryptedToken = await encryptSecret(accessToken)
      const tokenHint = maskSecret(accessToken)

      const newAccount = await createTriageAccount({
        provider: 'slack',
        label: slackTeamName,
        providerAccountId: slackTeamId,
        accessToken: encryptedToken,
        accessTokenHint: tokenHint,
        refreshToken: null,
        tokenExpiresAt: null,
        scopes: tokenData.scope || '',
        providerMetadata: {
          slackTeamName,
          botUserId: tokenData.bot_user_id || '',
        },
        status: 'connected',
        lastVerifiedAt: new Date(),
        teamId,
        owner: SYSTEM_USER_ID,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })

      accountId = (newAccount as any).id
      logger.info('[OAuth] Created new account', { accountId, slackTeamId })
    }

    // Determine which flow to add the input to
    let flowId: string
    let isNewFlow = false

    if (requestedFlowId) {
      // If specific flowId was provided, try to use that one
      try {
        // Look up the requested flow from existing flows
        const allFlows = await getAllTriageFlows(teamId) as any[]
        const requestedFlow: any = allFlows?.find((f: any) => f.id === requestedFlowId)

        if (requestedFlow) {
          flowId = requestedFlowId
          logger.debug('[OAuth] Using requested flow', { flowId, flowName: requestedFlow.name })
        } else {
          throw new Error('Flow not found')
        }
      } catch {
        // Requested flow doesn't exist, fall back to first flow or create new
        logger.warn('[OAuth] Requested flow not found, falling back', { requestedFlowId })
        const existingFlows = await getAllTriageFlows(teamId) as any[]
        if (existingFlows && existingFlows.length > 0) {
          flowId = existingFlows[0]!.id
          logger.debug('[OAuth] Using first existing flow', { flowId, flowName: existingFlows[0]!.name })
        } else {
          // Create new flow
          const newFlow = await createTriageFlow({
            name: `${slackTeamName} Flow`,
            description: 'Created via Slack OAuth',
            availableDomains: ['design', 'frontend', 'backend', 'product'],
            aiEnabled: true,
            aiSummaryPrompt: null,
            aiTaskPrompt: null,
            anthropicApiKey: null,
            onboardingComplete: false,
            active: true,
            teamId,
            owner: SYSTEM_USER_ID,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          flowId = (newFlow as any).id
          isNewFlow = true
          logger.info('[OAuth] Created new flow', { flowId, flowName: (newFlow as any).name })
        }
      }
    } else {
      // No specific flow requested - use first existing or create new (backward compatible)
      const existingFlows = await getAllTriageFlows(teamId) as any[]
      if (existingFlows && existingFlows.length > 0) {
        flowId = existingFlows[0]!.id
        logger.debug('[OAuth] Using first existing flow', { flowId, flowName: existingFlows[0]!.name })
      } else {
        // Create new flow with default settings
        const newFlow = await createTriageFlow({
          name: `${slackTeamName} Flow`,
          description: 'Created via Slack OAuth',
          availableDomains: ['design', 'frontend', 'backend', 'product'],
          aiEnabled: true,
          aiSummaryPrompt: null,
          aiTaskPrompt: null,
          anthropicApiKey: null,
          onboardingComplete: false,
          active: true,
          teamId,
          owner: SYSTEM_USER_ID,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        flowId = (newFlow as any).id
        isNewFlow = true
        logger.info('[OAuth] Created new flow', { flowId, flowName: (newFlow as any).name })
      }
    }

    // Check if this Slack workspace is already connected (by slackTeamId)
    const allInputs = await getAllTriageInputs(teamId) as any[]
    const existingInputs = allInputs?.filter((input: any) => input.flowId === flowId) || []
    const duplicateInput = existingInputs.find((input: any) =>
      input.sourceType === 'slack' &&
      input.sourceMetadata?.slackTeamId === slackTeamId
    )

    if (duplicateInput) {
      // Auto-migrate: if the input has an inline apiToken but no accountId, migrate it
      if (duplicateInput.apiToken && !duplicateInput.accountId) {
        logger.info('[OAuth] Auto-migrating duplicate input to use accountId', {
          inputId: duplicateInput.id,
          accountId,
        })
        await updateTriageInput(duplicateInput.id, teamId, SYSTEM_USER_ID, {
          accountId,
          apiToken: null, // Clear inline token
        })
      } else if (!duplicateInput.accountId) {
        // Link to account even if no inline token
        await updateTriageInput(duplicateInput.id, teamId, SYSTEM_USER_ID, {
          accountId,
        })
      }

      // Return success page (postMessage to opener popup)
      setResponseHeader(event, 'content-type', 'text/html')
      return oauthResultHtml({
        type: 'oauth-success',
        credentials: { accountId, flowId, inputId: duplicateInput.id },
        openerOrigin,
        provider: 'slack',
        status: 'already-connected',
        teamName: slackTeamName,
      })
    }

    // Create new Slack input — references account by ID instead of storing inline token
    const newInput = await createTriageInput({
      flowId,
      sourceType: 'slack',
      name: slackTeamName,
      apiToken: null, // No inline token — uses accountId
      accountId,
      webhookUrl: null, // Generated by Slack Events API
      webhookSecret: null,
      emailAddress: null,
      emailSlug: null,
      sourceMetadata: {
        slackTeamId,
        slackTeamName,
        botUserId: tokenData.bot_user_id || '',
        scopes: tokenData.scope || '',
      },
      active: true,
      teamId,
      owner: SYSTEM_USER_ID,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    })

    logger.info('[OAuth] Created Slack input', {
      flowId,
      inputId: (newInput as any).id,
      slackTeamId,
      isNewFlow,
    })

    // Return success page (postMessage to opener popup)
    setResponseHeader(event, 'content-type', 'text/html')
    return oauthResultHtml({
      type: 'oauth-success',
      credentials: { accountId, flowId, inputId: (newInput as any).id },
      openerOrigin,
      provider: 'slack',
      status: 'success',
      teamName: slackTeamName,
    })
  }
  catch (err) {
    logger.error('[OAuth] Callback handler failed', err as any)

    // If it's already a createError, rethrow it
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }

    // Otherwise, return generic error
    throw createError({
      status: 500,
      statusText: 'OAuth callback failed',
    })
  }
})
