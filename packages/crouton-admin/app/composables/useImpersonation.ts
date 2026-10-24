/**
 * useImpersonation Composable
 *
 * Provides impersonation functionality for super admins.
 * Allows viewing the app as a specific user for debugging purposes.
 *
 * @example
 * ```vue
 * <script setup>
 * const { isImpersonating, impersonatedUser, startImpersonation, stopImpersonation } = useImpersonation()
 *
 * // Start impersonating a user
 * await startImpersonation('user-id-123')
 *
 * // Check if currently impersonating
 * if (isImpersonating.value) {
 *   console.log('Impersonating:', impersonatedUser.value?.name)
 * }
 *
 * // Stop impersonation and return to admin
 * await stopImpersonation()
 * </script>
 * ```
 */
import type { ImpersonationState } from '../../types/admin'

export function useImpersonation() {
  const { t } = useT()
  // SSR-safe shared state via useState
  const impersonationState = useState<ImpersonationState>('impersonation-state', () => ({
    isImpersonating: false,
    originalAdminId: null,
    impersonatedUser: null
  }))
  const hasCheckedStatus = useState('impersonation-checked', () => false)
  const loading = useState('impersonation-loading', () => false)
  const error = useState<string | null>('impersonation-error', () => null)

  // Computed accessors
  const isImpersonating = computed(() => impersonationState.value.isImpersonating)
  const originalAdminId = computed(() => impersonationState.value.originalAdminId)
  const impersonatedUser = computed(() => impersonationState.value.impersonatedUser)

  /**
   * Check the current impersonation status from the server
   *
   * Called automatically on first use to restore state after page refresh.
   */
  async function checkStatus(): Promise<ImpersonationState> {
    loading.value = true
    error.value = null
    try {
      const state = await $fetch<ImpersonationState>('/api/admin/impersonate/status')
      impersonationState.value = state
      hasCheckedStatus.value = true
      return state
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('admin.impersonation.statusFailed')
      // Don't throw - just return current state
      return impersonationState.value
    } finally {
      loading.value = false
    }
  }

  /**
   * Start impersonating a user
   *
   * @param userId - ID of the user to impersonate
   * @throws Error if user not found, is a super admin, or is banned
   */
  async function startImpersonation(userId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const state = await $fetch<ImpersonationState>('/api/admin/impersonate/start', {
        method: 'POST',
        body: { userId }
      })

      impersonationState.value = state

      // Refresh the page to load the app as the impersonated user
      // The session has been modified on the server, so we need a full refresh
      window.location.href = window.location.pathname
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : t('admin.impersonation.startFailed')
      error.value = errorMessage
      throw new Error(errorMessage)
    } finally {
      loading.value = false
    }
  }

  /**
   * Stop impersonating and return to admin session
   *
   * @param redirectTo - URL to redirect to after stopping (default: /admin)
   */
  async function stopImpersonation(redirectTo: string = '/admin'): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const state = await $fetch<ImpersonationState>('/api/admin/impersonate/stop', {
        method: 'POST'
      })

      impersonationState.value = state

      // Refresh the page to load the app as the admin user
      // The session has been modified on the server, so we need a full refresh
      window.location.href = redirectTo
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : t('admin.impersonation.stopFailed')
      error.value = errorMessage
      throw new Error(errorMessage)
    } finally {
      loading.value = false
    }
  }

  // Check status on first use (handles page refresh)
  if (import.meta.client && !hasCheckedStatus.value) {
    // Run in background, don't block rendering
    checkStatus()
  }

  return {
    // State
    isImpersonating: readonly(isImpersonating),
    originalAdminId: readonly(originalAdminId),
    impersonatedUser: readonly(impersonatedUser),
    loading: readonly(loading),
    error: readonly(error),

    // Methods
    checkStatus,
    startImpersonation,
    stopImpersonation
  }
}
