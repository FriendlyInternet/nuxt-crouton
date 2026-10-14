/**
 * Composable for managing connected accounts (triageAccounts)
 *
 * Provides CRUD operations for team-scoped connected accounts.
 * Accounts store encrypted tokens for Slack, Notion, and other providers.
 *
 * @example
 * ```ts
 * const { accounts, fetchAccounts, verifyAccount, createManualAccount } = useTriageConnectedAccounts(teamId)
 *
 * const slackAccounts = getAccountsByProvider('slack')
 * ```
 */

// @ts-expect-error - layer types resolved at app level
import type { ConnectedAccount, AccountProvider } from '~/layers/triage/types'

export function useTriageConnectedAccounts(teamId: string | Ref<string>) {
  const resolvedTeamId = computed(() => toValue(teamId))

  const { data: accounts, status, error: fetchError, refresh } = useFetch<ConnectedAccount[]>(
    () => `/api/teams/${resolvedTeamId.value}/triage-accounts`,
    { default: () => [] as ConnectedAccount[], server: false },
  )

  const loading = computed(() => status.value === 'pending')
  const error = computed(() => {
    if (!fetchError.value) return null
    const err = fetchError.value as any
    return err.data?.statusMessage || err.message || 'Failed to fetch accounts'
  })

  /**
   * Get accounts filtered by provider
   */
  function getAccountsByProvider(provider: AccountProvider) {
    return computed(() =>
      accounts.value.filter(a => a.provider === provider),
    )
  }

  /**
   * Verify a connected account's token
   */
  async function verifyAccount(accountId: string) {
    if (!resolvedTeamId.value) return null

    try {
      const result = await $fetch<{ success: boolean; status: string; error?: string }>(
        `/api/crouton-triage/teams/${resolvedTeamId.value}/accounts/${accountId}/verify`,
        { method: 'POST' },
      )

      // Optimistic update
      const index = accounts.value.findIndex(a => a.id === accountId)
      if (index !== -1) {
        accounts.value[index] = {
          ...accounts.value[index],
          status: result.status as ConnectedAccount['status'],
          lastVerifiedAt: result.success ? new Date() : accounts.value[index].lastVerifiedAt,
        }
      }

      return result
    } catch (err: any) {
      console.error('[useTriageConnectedAccounts] verifyAccount failed:', err)
      return {
        success: false,
        status: 'error',
        error: err.data?.statusMessage || err.message || 'Verification failed',
      }
    }
  }

  /**
   * Create a manually connected account (e.g., paste Notion API token)
   */
  async function createManualAccount(data: {
    provider: AccountProvider
    label: string
    token: string
    providerAccountId?: string
    providerMetadata?: Record<string, any>
  }) {
    if (!resolvedTeamId.value) return null

    try {
      const result = await $fetch<{ success: boolean; account: any }>(
        `/api/crouton-triage/teams/${resolvedTeamId.value}/accounts/connect`,
        {
          method: 'POST',
          body: data,
        },
      )

      await refresh()

      return result
    } catch (err: any) {
      console.error('[useTriageConnectedAccounts] createManualAccount failed:', err)
      throw err
    }
  }

  /**
   * Delete a connected account
   */
  async function deleteAccount(accountId: string) {
    if (!resolvedTeamId.value) return

    try {
      await $fetch(
        `/api/teams/${resolvedTeamId.value}/triage-accounts/${accountId}`,
        { method: 'DELETE' },
      )

      // Optimistic update
      accounts.value = accounts.value.filter(a => a.id !== accountId)
    } catch (err: any) {
      console.error('[useTriageConnectedAccounts] deleteAccount failed:', err)
      throw err
    }
  }

  return {
    /** All connected accounts */
    accounts,
    /** Loading state */
    loading,
    /** Error message */
    error,
    /** Refresh accounts list */
    fetchAccounts: refresh,
    /** Get accounts by provider (returns computed) */
    getAccountsByProvider,
    /** Verify account token */
    verifyAccount,
    /** Create manual account */
    createManualAccount,
    /** Delete account */
    deleteAccount,
  }
}
