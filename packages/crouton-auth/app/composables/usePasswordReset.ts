/**
 * usePasswordReset Composable
 *
 * Password reset flow: request reset email and set new password with token.
 * Extracted from useAuth to keep concerns focused.
 *
 * @example
 * ```vue
 * <script setup>
 * const { forgotPassword, resetPassword } = usePasswordReset()
 * </script>
 * ```
 */
import { requireAuthClient } from '../../types/auth-client'

export function usePasswordReset() {

  const loading = ref(false)
  const error = ref<string | null>(null)

  async function forgotPassword(email: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await requireAuthClient().requestPasswordReset({
        email,
        redirectTo: window.location.origin + '/auth/reset-password'
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Request failed')
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Request failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function resetPassword(token: string, password: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await requireAuthClient().resetPassword({
        token,
        newPassword: password
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Reset failed')
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Reset failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    loading: readonly(loading),
    error: readonly(error),
    forgotPassword,
    resetPassword
  }
}
