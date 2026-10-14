/**
 * Manually connect an account (e.g., paste a Notion API token)
 *
 * POST /api/crouton-triage/teams/:id/accounts/connect
 *
 * Body: { provider, label, token, providerAccountId?, providerMetadata? }
 *
 * Encrypts the token, deduplicates by providerAccountId, and stores the account.
 */

import { z } from 'zod'

const bodySchema = z.object({
  provider: z.enum(['slack', 'notion', 'figma', 'github', 'linear']),
  label: z.string().min(1, 'Label is required'),
  token: z.string().min(1, 'Token is required'),
  providerAccountId: z.string().optional(),
  providerMetadata: z.record(z.string(), z.any()).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)

  const teamId = getRouterParam(event, 'id')

  if (!teamId) {
    throw createError({
      status: 400,
      statusText: 'Missing teamId',
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  const { getAllTriageAccounts, createTriageAccount, updateTriageAccount } = await import(
    '~~/layers/triage/collections/accounts/server/database/queries'
  )
  const { SYSTEM_USER_ID } = await import('../../../../../utils/constants')

  // Determine providerAccountId — for Notion we can try to resolve it via API
  let providerAccountId = body.providerAccountId || ''

  if (!providerAccountId && body.provider === 'notion') {
    try {
      const response = await $fetch<{ bot?: { workspace_name?: string; owner?: { workspace?: boolean } } }>('https://api.notion.com/v1/users/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${body.token}`,
          'Notion-Version': '2022-06-28',
        },
      })
      // Use workspace name as fallback identifier
      providerAccountId = response.bot?.workspace_name || `notion-${Date.now()}`
    } catch {
      providerAccountId = `notion-${Date.now()}`
    }
  }

  if (!providerAccountId) {
    providerAccountId = `${body.provider}-${Date.now()}`
  }

  // Check for existing account (deduplicate)
  const allAccounts = await getAllTriageAccounts(teamId)
  const existingAccount = allAccounts?.find(
    (a: any) => a.provider === body.provider && a.providerAccountId === providerAccountId
  )

  const encryptedToken = await encryptSecret(body.token)
  const tokenHint = maskSecret(body.token)

  if (existingAccount) {
    // Update existing account
    await updateTriageAccount(existingAccount.id, teamId, SYSTEM_USER_ID, {
      accessToken: encryptedToken,
      accessTokenHint: tokenHint,
      label: body.label,
      status: 'connected',
      lastVerifiedAt: new Date(),
      providerMetadata: body.providerMetadata || existingAccount.providerMetadata,
    })

    return {
      success: true,
      account: {
        id: existingAccount.id,
        provider: body.provider,
        label: body.label,
        providerAccountId,
        accessTokenHint: tokenHint,
        status: 'connected',
        updated: true,
      },
    }
  }

  // Create new account
  const newAccount = await createTriageAccount({
    provider: body.provider,
    label: body.label,
    providerAccountId,
    accessToken: encryptedToken,
    accessTokenHint: tokenHint,
    refreshToken: undefined,
    tokenExpiresAt: null,
    scopes: '',
    providerMetadata: body.providerMetadata || {},
    status: 'connected',
    lastVerifiedAt: new Date(),
    teamId,
    owner: SYSTEM_USER_ID,
    createdBy: user.id,
    updatedBy: user.id,
  } as any)

  return {
    success: true,
    account: {
      id: newAccount.id,
      provider: body.provider,
      label: body.label,
      providerAccountId,
      accessTokenHint: tokenHint,
      status: 'connected',
      updated: false,
    },
  }
})
