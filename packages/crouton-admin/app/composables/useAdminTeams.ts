/**
 * useAdminTeams Composable
 *
 * Provides team/organization management functionality for super admins.
 * Wraps the admin team API endpoints with reactive state.
 *
 * @example
 * ```vue
 * <script setup>
 * const { teams, loading, getTeams, getTeam, getTeamMembers } = useAdminTeams()
 *
 * // Load teams with filters
 * await getTeams({ personal: false, page: 1 })
 *
 * // Get team details
 * const team = await getTeam('team-id')
 * console.log(team.members)
 * </script>
 * ```
 */
import { ref, readonly } from 'vue'
import type {
  AdminTeamListItem,
  AdminTeamDetail,
  TeamListFilters,
  PaginatedResponse
} from '../../types/admin'

export function useAdminTeams() {
  const { t } = useT()
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Current paginated list state
  const teams = ref<AdminTeamListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const totalPages = ref(0)

  /** Wrap an async operation with loading/error state management */
  async function withLoading<T>(fn: () => Promise<T>, errorMessage: string): Promise<T> {
    loading.value = true
    error.value = null
    try {
      return await fn()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : errorMessage
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch paginated list of teams/organizations
   */
  async function getTeams(filters?: TeamListFilters): Promise<PaginatedResponse<AdminTeamListItem>> {
    return withLoading(async () => {
      const query: Record<string, string> = {}
      if (filters?.page) query.page = String(filters.page)
      if (filters?.pageSize) query.pageSize = String(filters.pageSize)
      if (filters?.search) query.search = filters.search
      if (filters?.personal !== undefined) query.personal = String(filters.personal)
      if (filters?.sortBy) query.sortBy = filters.sortBy
      if (filters?.sortOrder) query.sortOrder = filters.sortOrder

      const response = await $fetch<PaginatedResponse<AdminTeamListItem>>('/api/admin/teams', { query })

      teams.value = response.items
      total.value = response.total
      page.value = response.page
      pageSize.value = response.pageSize
      totalPages.value = response.totalPages

      return response
    }, t('superAdmin.teams.failedToLoadTeams'))
  }

  /**
   * Get detailed team information by ID
   */
  async function getTeam(teamId: string): Promise<AdminTeamDetail> {
    return withLoading(
      () => $fetch<AdminTeamDetail>(`/api/admin/teams/${teamId}`),
      t('superAdmin.teams.failedToLoadTeam')
    )
  }

  /**
   * Get team members
   *
   * Convenience method that fetches team detail and returns just the members.
   */
  async function getTeamMembers(teamId: string): Promise<AdminTeamDetail['members']> {
    const team = await getTeam(teamId)
    return team.members
  }

  return {
    // State
    teams: readonly(teams),
    total: readonly(total),
    page: readonly(page),
    pageSize: readonly(pageSize),
    totalPages: readonly(totalPages),
    loading: readonly(loading),
    error: readonly(error),

    // Methods
    getTeams,
    getTeam,
    getTeamMembers
  }
}
