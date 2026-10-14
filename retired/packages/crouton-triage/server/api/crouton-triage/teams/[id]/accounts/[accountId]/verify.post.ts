/**
 * Verify a connected account's token
 *
 * POST /api/crouton-triage/teams/:id/accounts/:accountId/verify
 *
 * Decrypts the token and makes a provider-specific API call to verify it's still valid.
 * Updates the account status and lastVerifiedAt accordingly.
 */

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const teamId = getRouterParam(event, 'id')
  const accountId = getRouterParam(event, 'accountId')

  if (!teamId || !accountId) {
    throw createError({
      status: 400,
      statusText: 'Missing teamId or accountId',
    })
  }

  const { getTriageAccountsByIds, updateTriageAccount } = await import(
    '~~/layers/triage/collections/accounts/server/database/queries'
  )
  const { SYSTEM_USER_ID } = await import('../../../../../../utils/constants')

  const accounts = await getTriageAccountsByIds(teamId, [accountId])
  const account = accounts[0]
  if (!account) {
    throw createError({
      status: 404,
      statusText: 'Account not found',
    })
  }

  // Decrypt the token
  let token: string
  try {
    token = await decryptSecret(account.accessToken)
  } catch {
    await updateTriageAccount(accountId, teamId, SYSTEM_USER_ID, {
      status: 'error',
    })
    throw createError({
      status: 500,
      statusText: 'Failed to decrypt account token',
    })
  }

  // Verify with provider-specific API call
  try {
    if (account.provider === 'slack') {
      const response = await $fetch<{ ok: boolean; error?: string }>('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        await updateTriageAccount(accountId, teamId, SYSTEM_USER_ID, {
          status: response.error === 'token_revoked' ? 'revoked' : 'expired',
        })

        return {
          success: false,
          status: response.error === 'token_revoked' ? 'revoked' : 'expired',
          error: response.error,
        }
      }
    } else if (account.provider === 'notion') {
      const response = await $fetch<{ object: string }>('https://api.notion.com/v1/users/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
        },
      })

      if (!response.object) {
        await updateTriageAccount(accountId, teamId, SYSTEM_USER_ID, {
          status: 'error',
        })

        return {
          success: false,
          status: 'error',
          error: 'Unexpected Notion API response',
        }
      }
    } else {
      // For unsupported providers, just mark as verified (token decrypted OK)
    }

    // Success — update status and verification timestamp
    await updateTriageAccount(accountId, teamId, SYSTEM_USER_ID, {
      status: 'connected',
      lastVerifiedAt: new Date(),
    })

    return {
      success: true,
      status: 'connected',
    }
  } catch (error: any) {
    const isAuthError = error.status === 401 || error.status === 403
    const newStatus = isAuthError ? 'expired' : 'error'

    await updateTriageAccount(accountId, teamId, SYSTEM_USER_ID, {
      status: newStatus,
    })

    return {
      success: false,
      status: newStatus,
      error: error.message || 'Verification failed',
    }
  }
})
