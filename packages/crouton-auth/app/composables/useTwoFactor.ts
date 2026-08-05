/**
 * useTwoFactor Composable
 *
 * Two-factor authentication management: enable/disable TOTP, backup codes, verification.
 * Extracted from useAuth to keep concerns focused.
 *
 * @example
 * ```vue
 * <script setup>
 * const { enable2FA, disable2FA, verifyTotp, get2FAStatus } = useTwoFactor()
 * </script>
 * ```
 */
import type { TotpSetupData, VerifyTotpOptions, TwoFactorStatus } from './useAuth'
import { requireAuthClient } from '../../types/auth-client'

export function useTwoFactor() {
  const config = useAuthConfig()
  const { user: sessionUser, refresh } = useSession()

  const loading = ref(false)
  const error = ref<string | null>(null)

  const has2FA = computed(() => {
    const method = config?.methods?.twoFactor
    return method === true || (typeof method === 'object' && method.enabled !== false)
  })

  async function enable2FA(password: string): Promise<TotpSetupData> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        throw new Error('Two-factor authentication is not enabled')
      }

      const result = await requireAuthClient().twoFactor.enable({ password })

      if (result.error) {
        throw new Error(result.error.message ?? 'Enable 2FA failed')
      }

      if (!result.data) {
        throw new Error('No data returned from enable 2FA')
      }

      return {
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes ?? []
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Enable 2FA failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function disable2FA(password: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        throw new Error('Two-factor authentication is not enabled')
      }

      const result = await requireAuthClient().twoFactor.disable({ password })

      if (result.error) {
        throw new Error(result.error.message ?? 'Disable 2FA failed')
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Disable 2FA failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function getTotpUri(password: string): Promise<string> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        throw new Error('Two-factor authentication is not enabled')
      }

      // Better Auth 1.4.x: getTotpUri requires password
      const result = await requireAuthClient().twoFactor.getTotpUri({ password })

      if (result.error) {
        throw new Error(result.error.message ?? 'Get TOTP URI failed')
      }

      return result.data?.totpURI ?? ''
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Get TOTP URI failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function verifyTotp(options: VerifyTotpOptions): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        throw new Error('Two-factor authentication is not enabled')
      }

      const result = await requireAuthClient().twoFactor.verifyTotp({
        code: options.code,
        trustDevice: options.trustDevice
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Verify TOTP failed')
      }

      await refresh()
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Verify TOTP failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function generateBackupCodes(password: string): Promise<string[]> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        throw new Error('Two-factor authentication is not enabled')
      }

      const result = await requireAuthClient().twoFactor.generateBackupCodes({ password })

      if (result.error) {
        throw new Error(result.error.message ?? 'Generate backup codes failed')
      }

      return result.data?.backupCodes ?? []
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Generate backup codes failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function verifyBackupCode(code: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        throw new Error('Two-factor authentication is not enabled')
      }

      const result = await requireAuthClient().twoFactor.verifyBackupCode({ code })

      if (result.error) {
        throw new Error(result.error.message ?? 'Verify backup code failed')
      }

      await refresh()
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Verify backup code failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function get2FAStatus(): Promise<TwoFactorStatus> {
    loading.value = true
    error.value = null
    try {
      if (!has2FA.value) {
        return { enabled: false, hasTotp: false, hasBackupCodes: false }
      }

      const userData = sessionUser.value
      if (!userData) {
        return { enabled: false, hasTotp: false, hasBackupCodes: false }
      }

      const result = await requireAuthClient().getSession()
      const session = result.data
      const twoFactorEnabled = (session?.user as { twoFactorEnabled?: boolean })?.twoFactorEnabled ?? false

      return {
        enabled: twoFactorEnabled,
        hasTotp: twoFactorEnabled,
        hasBackupCodes: twoFactorEnabled
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Get 2FA status failed'
      return { enabled: false, hasTotp: false, hasBackupCodes: false }
    } finally {
      loading.value = false
    }
  }

  return {
    loading: readonly(loading),
    error: readonly(error),
    has2FA,

    enable2FA,
    disable2FA,
    getTotpUri,
    verifyTotp,
    generateBackupCodes,
    verifyBackupCode,
    get2FAStatus
  }
}
