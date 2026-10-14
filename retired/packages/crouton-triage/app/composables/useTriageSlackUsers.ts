/**
 * Composable for fetching Slack workspace users
 *
 * Handles fetching users from a Slack workspace for user mapping.
 * Uses the /api/crouton-triage/slack/users endpoint which requires users:read scope.
 *
 * @example
 * ```ts
 * const { fetchSlackUsers, users, loading, error } = useTriageSlackUsers()
 *
 * await fetchSlackUsers({
 *   slackToken: 'xoxb-xxx',
 *   teamId: 'T12345'
 * })
 *
 * if (users.value) {
 *   console.log('Found', users.value.length, 'users')
 * }
 * ```
 */

export interface SlackUser {
  id: string
  name: string
  email: string | null
  avatar: string | null
  realName: string | null
}

export interface FetchSlackUsersOptions {
  slackToken?: string
  accountId?: string
  teamId: string
}

export function useTriageSlackUsers() {
  const fetchParams = ref<FetchSlackUsersOptions | null>(null)

  const { data: users, status, error: fetchError, execute, clear } = useAsyncData<SlackUser[]>(
    `triage-slack-users-${useId()}`,
    async () => {
      const opts = fetchParams.value
      if (!opts || ((!opts.slackToken && !opts.accountId) || !opts.teamId)) {
        throw new Error('Please provide a Slack token or account ID, and team ID')
      }

      const query: Record<string, string> = {}
      if (opts.accountId) query.accountId = opts.accountId
      else if (opts.slackToken) query.slackToken = opts.slackToken

      const response = await $fetch<{
        success: boolean
        users: SlackUser[]
        total: number
      }>(`/api/crouton-triage/teams/${opts.teamId}/slack/users`, {
        query,
      })

      if (!response.success) throw new Error('Failed to fetch Slack users')
      return response.users
    },
    { immediate: false, default: () => [] as SlackUser[] },
  )

  const loading = computed(() => status.value === 'pending')
  const error = computed(() => {
    if (!fetchError.value) return null
    const err = fetchError.value as any
    if (err.statusCode === 403 || err.data?.statusMessage?.includes('missing_scope')) {
      return 'Slack integration needs re-authorization with users:read scope'
    }
    if (err.statusCode === 401) return 'Invalid Slack token or insufficient permissions'
    if (err.statusCode === 429) return 'Slack rate limit exceeded. Please try again later.'
    return err.data?.statusMessage || err.message || 'Failed to fetch Slack users'
  })

  /**
   * Fetch Slack workspace users
   */
  async function fetchSlackUsers(options: FetchSlackUsersOptions): Promise<SlackUser[]> {
    fetchParams.value = options
    await execute()
    return users.value
  }

  /**
   * Clear users and error state
   */
  function clearUsers() {
    clear()
    fetchParams.value = null
  }

  return {
    fetchSlackUsers,
    clearUsers,
    users,
    loading,
    error,
  }
}
