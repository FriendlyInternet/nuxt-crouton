/**
 * Composable for fetching Notion workspace users
 *
 * Wrapper around the /api/crouton-triage/notion/users endpoint for use in user mapping.
 * Filters out bots by default and provides search functionality.
 *
 * @example
 * ```ts
 * const { fetchNotionUsers, users, loading, error } = useTriageNotionUsers()
 *
 * await fetchNotionUsers({
 *   notionToken: 'secret_xxx',
 *   teamId: 'team123'
 * })
 *
 * // Search users
 * const results = searchUsers('john')
 * ```
 */

export interface NotionUser {
  id: string
  name: string
  email: string | null
  type: 'person' | 'bot'
  avatarUrl: string | null
}

export interface FetchNotionUsersOptions {
  notionToken?: string
  accountId?: string
  teamId: string
  includeBots?: boolean
}

export function useTriageNotionUsers() {
  const fetchParams = ref<FetchNotionUsersOptions | null>(null)

  const { data: users, status, error: fetchError, execute, clear } = useAsyncData<NotionUser[]>(
    `triage-notion-users-${useId()}`,
    async () => {
      const opts = fetchParams.value
      if (!opts || ((!opts.notionToken && !opts.accountId) || !opts.teamId)) {
        throw new Error('Please provide a Notion token or account ID, and team ID')
      }

      const query: Record<string, string> = { includeBots: (opts.includeBots ?? false).toString() }
      if (opts.accountId) query.accountId = opts.accountId
      else if (opts.notionToken) query.notionToken = opts.notionToken

      const response = await $fetch<{
        success: boolean
        users: NotionUser[]
        total: number
      }>(`/api/crouton-triage/teams/${opts.teamId}/notion/users`, {
        query,
      })

      if (!response.success) throw new Error('Failed to fetch Notion users')
      return response.users
    },
    { immediate: false, default: () => [] as NotionUser[] },
  )

  const loading = computed(() => status.value === 'pending')
  const error = computed(() => {
    if (!fetchError.value) return null
    const err = fetchError.value as any
    if (err.statusCode === 401) return 'Invalid Notion token or insufficient permissions'
    if (err.statusCode === 429) return 'Notion rate limit exceeded. Please try again later.'
    return err.data?.statusMessage || err.message || 'Failed to fetch Notion users'
  })

  /**
   * Fetch Notion workspace users
   */
  async function fetchNotionUsers(options: FetchNotionUsersOptions): Promise<NotionUser[]> {
    fetchParams.value = options
    await execute()
    return users.value
  }

  /**
   * Search users by name or email
   */
  function searchUsers(query: string): NotionUser[] {
    if (!query.trim()) return users.value
    const lowerQuery = query.toLowerCase()
    return users.value.filter(user =>
      user.name.toLowerCase().includes(lowerQuery)
      || (user.email && user.email.toLowerCase().includes(lowerQuery)),
    )
  }

  /**
   * Find user by ID
   */
  function findUserById(id: string): NotionUser | undefined {
    return users.value.find(user => user.id === id)
  }

  /**
   * Find user by email
   */
  function findUserByEmail(email: string): NotionUser | undefined {
    if (!email) return undefined
    const lowerEmail = email.toLowerCase()
    return users.value.find(user =>
      user.email && user.email.toLowerCase() === lowerEmail,
    )
  }

  /**
   * Clear users and error state
   */
  function clearUsers() {
    clear()
    fetchParams.value = null
  }

  return {
    fetchNotionUsers,
    searchUsers,
    findUserById,
    findUserByEmail,
    clearUsers,
    users,
    loading,
    error,
  }
}
