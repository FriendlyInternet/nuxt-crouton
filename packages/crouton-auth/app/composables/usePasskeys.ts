/**
 * usePasskeys Composable
 *
 * Passkey (WebAuthn) management: registration, login, listing, deletion.
 * Extracted from useAuth to keep concerns focused.
 *
 * @example
 * ```vue
 * <script setup>
 * const { addPasskey, listPasskeys, deletePasskey, isWebAuthnSupported } = usePasskeys()
 * </script>
 * ```
 */
import type { PasskeyInfo, AddPasskeyOptions } from './useAuth'
import { requireAuthClient } from '../../types/auth-client'

export function usePasskeys() {
  const { t } = useT()
  const config = useAuthConfig()
  const { refresh } = useSession()

  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasPasskeys = computed(() => {
    const method = config?.methods?.passkeys
    return method === true || (typeof method === 'object' && method.enabled !== false)
  })

  // ============================================================================
  // Login Methods
  // ============================================================================

  async function loginWithPasskey(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!hasPasskeys.value) {
        throw new Error('Passkeys are not enabled')
      }

      const result = await requireAuthClient().signIn.passkey()

      if (result.error) {
        throw new Error(result.error.message ?? t('auth.passkeyLoginFailed'))
      }

      await refresh()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('auth.passkeyLoginFailed')
      throw e
    } finally {
      loading.value = false
    }
  }

  async function loginWithPasskeyAutofill(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!hasPasskeys.value) {
        throw new Error('Passkeys are not enabled')
      }

      const result = await requireAuthClient().signIn.passkey({
        autoFill: true
      })

      if (result.error) {
        throw new Error(result.error.message ?? t('auth.passkeyLoginFailed'))
      }

      await refresh()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('auth.passkeyLoginFailed')
      throw e
    } finally {
      loading.value = false
    }
  }

  // ============================================================================
  // Management Methods
  // ============================================================================

  async function addPasskey(options?: AddPasskeyOptions): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!hasPasskeys.value) {
        throw new Error('Passkeys are not enabled')
      }

      const result = await requireAuthClient().passkey.addPasskey({
        name: options?.name
      })

      if (result.error) {
        throw new Error(result.error.message ?? t('account.passkey.failedToAddPasskey'))
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('account.passkey.failedToAddPasskey')
      throw e
    } finally {
      loading.value = false
    }
  }

  async function listPasskeys(): Promise<PasskeyInfo[]> {
    loading.value = true
    error.value = null
    try {
      if (!hasPasskeys.value) {
        return []
      }

      const result = await requireAuthClient().passkey.listUserPasskeys()

      if (result.error) {
        throw new Error(result.error.message ?? t('account.passkey.failedToLoadPasskeys'))
      }

      return (result.data ?? []).map((p: { id: string, name?: string, createdAt: string | Date, credentialID: string }) => ({
        id: p.id,
        name: p.name ?? t('account.passkey.unnamed'),
        createdAt: new Date(p.createdAt),
        credentialId: p.credentialID
      }))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('account.passkey.failedToLoadPasskeys')
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deletePasskey(id: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!hasPasskeys.value) {
        throw new Error('Passkeys are not enabled')
      }

      const result = await requireAuthClient().passkey.deletePasskey({ id })

      if (result.error) {
        throw new Error(result.error.message ?? t('account.passkey.failedToDeletePasskey'))
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('account.passkey.failedToDeletePasskey')
      throw e
    } finally {
      loading.value = false
    }
  }

  async function updatePasskey(_id: string, _name: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!hasPasskeys.value) {
        throw new Error('Passkeys are not enabled')
      }

      console.warn('[@crouton/auth] Passkey update not yet supported by Better Auth')
      throw new Error('Passkey update is not currently supported. Delete and re-add instead.')
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('account.passkey.failedToUpdatePasskey')
      throw e
    } finally {
      loading.value = false
    }
  }

  // ============================================================================
  // WebAuthn Support Helpers
  // ============================================================================

  function isWebAuthnSupported(): boolean {
    if (import.meta.server) return false
    return (
      typeof PublicKeyCredential !== 'undefined'
      && typeof navigator.credentials !== 'undefined'
    )
  }

  async function isConditionalUIAvailable(): Promise<boolean> {
    if (!isWebAuthnSupported()) return false
    if (typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function') {
      return false
    }
    try {
      return await PublicKeyCredential.isConditionalMediationAvailable()
    } catch {
      return false
    }
  }

  return {
    loading: readonly(loading),
    error: readonly(error),
    hasPasskeys,

    // Login
    loginWithPasskey,
    loginWithPasskeyAutofill,

    // Management
    addPasskey,
    listPasskeys,
    deletePasskey,
    updatePasskey,

    // WebAuthn support
    isWebAuthnSupported,
    isConditionalUIAvailable
  }
}
