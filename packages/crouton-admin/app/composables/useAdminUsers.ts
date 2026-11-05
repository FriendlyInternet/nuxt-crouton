/**
 * useAdminUsers Composable
 *
 * Provides user management functionality for super admins.
 * Wraps the admin user API endpoints with reactive state.
 *
 * @example
 * ```vue
 * <script setup>
 * const { users, loading, getUsers, banUser, deleteUser } = useAdminUsers()
 *
 * // Load users with filters
 * await getUsers({ status: 'active', page: 1 })
 *
 * // Ban a user
 * await banUser('user-id', { reason: 'Spam', duration: 168 })
 *
 * // Delete a user
 * await deleteUser('user-id')
 * </script>
 * ```
 */
import { ref, readonly } from 'vue'
import type {
  AdminUserListItem,
  AdminUserDetail,
  AdminUser,
  UserListFilters,
  PaginatedResponse,
  BanPayload,
  CreateUserPayload
} from '../../types/admin'

export function useAdminUsers() {
  const { t } = useT()
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Current paginated list state
  const users = ref<AdminUserListItem[]>([])
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
   * Fetch paginated list of users
   */
  async function getUsers(filters?: UserListFilters): Promise<PaginatedResponse<AdminUserListItem>> {
    return withLoading(async () => {
      const query: Record<string, string> = {}
      if (filters?.page) query.page = String(filters.page)
      if (filters?.pageSize) query.pageSize = String(filters.pageSize)
      if (filters?.search) query.search = filters.search
      if (filters?.status) query.status = filters.status
      if (filters?.superAdmin !== undefined) query.superAdmin = String(filters.superAdmin)
      if (filters?.sortBy) query.sortBy = filters.sortBy
      if (filters?.sortOrder) query.sortOrder = filters.sortOrder

      const response = await $fetch<PaginatedResponse<AdminUserListItem>>('/api/admin/users', { query })

      users.value = response.items
      total.value = response.total
      page.value = response.page
      pageSize.value = response.pageSize
      totalPages.value = response.totalPages

      return response
    }, t('superAdmin.users.failedToLoadUsers'))
  }

  /**
   * Get detailed user information by ID
   */
  async function getUser(userId: string): Promise<AdminUserDetail> {
    return withLoading(
      () => $fetch<AdminUserDetail>(`/api/admin/users/${userId}`),
      t('superAdmin.users.failedToLoadUser')
    )
  }

  /**
   * Create a new user
   */
  async function createUser(data: CreateUserPayload): Promise<AdminUser> {
    return withLoading(
      () => $fetch<AdminUser>('/api/admin/users/create', { method: 'POST', body: data }),
      t('superAdmin.users.failedToCreate')
    )
  }

  /**
   * Ban a user
   */
  async function banUser(userId: string, payload: Omit<BanPayload, 'userId'>): Promise<AdminUser> {
    return withLoading(async () => {
      const response = await $fetch<AdminUser>('/api/admin/users/ban', {
        method: 'POST',
        body: { userId, ...payload }
      })

      // Update user in local list if present
      const index = users.value.findIndex(u => u.id === userId)
      if (index !== -1) {
        users.value[index] = {
          ...users.value[index]!,
          banned: response.banned,
          bannedReason: response.bannedReason,
          bannedUntil: response.bannedUntil
        } as any
      }

      return response
    }, t('superAdmin.users.failedToBan'))
  }

  /**
   * Unban a user
   */
  async function unbanUser(userId: string): Promise<AdminUser> {
    return withLoading(async () => {
      const response = await $fetch<AdminUser>('/api/admin/users/unban', {
        method: 'POST',
        body: { userId }
      })

      // Update user in local list if present
      const index = users.value.findIndex(u => u.id === userId)
      if (index !== -1) {
        users.value[index] = {
          ...users.value[index]!,
          banned: response.banned,
          bannedReason: response.bannedReason,
          bannedUntil: response.bannedUntil
        } as any
      }

      return response
    }, t('superAdmin.users.failedToUnban'))
  }

  /**
   * Delete a user permanently
   */
  async function deleteUser(userId: string): Promise<{ success: boolean, message: string }> {
    return withLoading(async () => {
      const response = await $fetch<{ success: boolean, message: string, deletedUserId: string }>('/api/admin/users/delete', {
        method: 'DELETE',
        body: { userId }
      })

      // Remove user from local list if present
      const index = users.value.findIndex(u => u.id === userId)
      if (index !== -1) {
        users.value.splice(index, 1)
        total.value -= 1
      }

      return response
    }, t('superAdmin.users.failedToDelete'))
  }

  return {
    // State
    users: readonly(users),
    total: readonly(total),
    page: readonly(page),
    pageSize: readonly(pageSize),
    totalPages: readonly(totalPages),
    loading: readonly(loading),
    error: readonly(error),

    // Methods
    getUsers,
    getUser,
    createUser,
    banUser,
    unbanUser,
    deleteUser
  }
}
