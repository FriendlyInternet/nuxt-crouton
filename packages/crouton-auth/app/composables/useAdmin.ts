/**
 * useAdmin Composable
 *
 * Provides admin actions for team management:
 * ban/unban users, revoke sessions, impersonate, send password reset.
 * Wraps better-auth admin client methods.
 *
 * @example
 * ```vue
 * <script setup>
 * const { banUser, sendPasswordReset, revokeUserSessions } = useAdmin()
 * </script>
 * ```
 */
import { useAuthClientSafe } from '../../types/auth-client'

export function useAdmin() {
  const authClient = useAuthClientSafe()
  const notify = useNotify()
  const { t } = useT()

  const loading = ref(false)

  // Send password reset email for a user
  async function sendPasswordReset(email: string) {
    loading.value = true
    try {
      await authClient?.requestPasswordReset({ email, redirectTo: '/auth/reset-password' })
      notify.success(t('admin.passwordResetSent'), { description: t('admin.passwordResetSentDescription', { email }) })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToSendPasswordReset')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Ban a user
  async function banUser(userId: string, options?: { banReason?: string, banExpiresIn?: number }) {
    loading.value = true
    try {
      await authClient?.admin.banUser({ userId, ...options })
      notify.success(t('admin.userBanned'), { description: t('admin.userBannedDescription') })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToBanUser')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Unban a user
  async function unbanUser(userId: string) {
    loading.value = true
    try {
      await authClient?.admin.unbanUser({ userId })
      notify.success(t('admin.userUnbanned'), { description: t('admin.userUnbannedDescription') })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToUnbanUser')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Revoke all sessions for a user (force logout)
  async function revokeUserSessions(userId: string) {
    loading.value = true
    try {
      await authClient?.admin.revokeUserSessions({ userId })
      notify.success(t('admin.sessionsRevoked'), { description: t('admin.sessionsRevokedDescription') })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToRevokeSessions')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Impersonate a user
  async function impersonateUser(userId: string) {
    loading.value = true
    try {
      await authClient?.admin.impersonateUser({ userId })
      notify.success(t('admin.impersonating'), { description: t('admin.impersonatingDescription') })
      if (import.meta.client) {
        window.location.reload()
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToImpersonate')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Stop impersonating
  async function stopImpersonating() {
    loading.value = true
    try {
      await authClient?.admin.stopImpersonating()
      notify.success(t('admin.stoppedImpersonating'))
      if (import.meta.client) {
        window.location.reload()
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToStopImpersonating')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Bulk: send password reset to multiple users
  async function bulkSendPasswordReset(emails: string[]) {
    loading.value = true
    try {
      await Promise.allSettled(emails.map(email =>
        authClient?.requestPasswordReset({ email, redirectTo: '/auth/reset-password' })
      ))
      notify.success(t('admin.bulkPasswordResetSent'), { description: t('admin.bulkPasswordResetSentDescription', { count: emails.length }) })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToBulkSendPasswordReset')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Bulk: ban multiple users
  async function bulkBanUsers(userIds: string[], options?: { banReason?: string, banExpiresIn?: number }) {
    loading.value = true
    try {
      await Promise.allSettled(userIds.map(userId => authClient?.admin.banUser({ userId, ...options })))
      notify.success(t('admin.bulkUsersBanned'), { description: t('admin.bulkUsersBannedDescription', { count: userIds.length }) })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToBulkBanUsers')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Bulk: unban multiple users
  async function bulkUnbanUsers(userIds: string[]) {
    loading.value = true
    try {
      await Promise.allSettled(userIds.map(userId => authClient?.admin.unbanUser({ userId })))
      notify.success(t('admin.bulkUsersUnbanned'), { description: t('admin.bulkUsersUnbannedDescription', { count: userIds.length }) })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToBulkUnbanUsers')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  // Bulk: revoke sessions for multiple users
  async function bulkRevokeUserSessions(userIds: string[]) {
    loading.value = true
    try {
      await Promise.allSettled(userIds.map(userId => authClient?.admin.revokeUserSessions({ userId })))
      notify.success(t('admin.bulkSessionsRevoked'), { description: t('admin.bulkSessionsRevokedDescription', { count: userIds.length }) })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.failedToBulkRevokeSessions')
      notify.error(t('errors.generic'), { description: message })
    } finally {
      loading.value = false
    }
  }

  return {
    loading: readonly(loading),
    sendPasswordReset,
    banUser,
    unbanUser,
    revokeUserSessions,
    impersonateUser,
    stopImpersonating,
    bulkSendPasswordReset,
    bulkBanUsers,
    bulkUnbanUsers,
    bulkRevokeUserSessions
  }
}
