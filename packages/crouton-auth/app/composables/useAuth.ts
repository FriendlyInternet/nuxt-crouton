/**
 * useAuth Composable
 *
 * Main authentication composable providing reactive user state and core auth methods.
 * Wraps Better Auth client functionality with type-safe methods.
 *
 * For specialized auth features, use the focused composables:
 * - `usePasskeys()` — Passkey/WebAuthn management and login
 * - `useTwoFactor()` — 2FA enable/disable, TOTP verification, backup codes
 * - `usePasswordReset()` — Forgot password and reset flows
 *
 * @example
 * ```vue
 * <script setup>
 * const { user, loggedIn, login, logout } = useAuth()
 *
 * async function handleLogin() {
 *   await login({ email: 'user@example.com', password: 'password' })
 * }
 * </script>
 * ```
 */
import type { User } from '../../types'
import { useAuthClient } from '../../types/auth-client'

export interface LoginCredentials {
  email: string
  password: string
  rememberMe?: boolean
}

export interface RegisterData {
  email: string
  password: string
  name?: string
}

export interface PasskeyInfo {
  id: string
  name: string
  createdAt: Date
  lastUsedAt?: Date
  credentialId: string
}

export interface AddPasskeyOptions {
  /** Name for the passkey (e.g., "My Laptop", "Work Phone") */
  name?: string
  /**
   * Authenticator attachment preference
   * - 'platform': Built-in authenticators (fingerprint, Face ID)
   * - 'cross-platform': External devices (security keys)
   */
  authenticatorAttachment?: 'platform' | 'cross-platform'
}

// ============================================================================
// Two-Factor Authentication Types
// ============================================================================

export interface TwoFactorStatus {
  /** Whether 2FA is enabled for the current user */
  enabled: boolean
  /** Whether TOTP is set up */
  hasTotp: boolean
  /** Whether backup codes have been generated */
  hasBackupCodes: boolean
}

export interface TotpSetupData {
  /** TOTP URI for QR code generation */
  totpURI: string
  /** Backup codes returned from enable 2FA */
  backupCodes: string[]
}

export interface VerifyTotpOptions {
  /** TOTP code from authenticator app */
  code: string
  /** Trust this device (skip 2FA for 30 days) */
  trustDevice?: boolean
}

export interface BackupCodeInfo {
  /** The backup code */
  code: string
  /** Whether this code has been used */
  used: boolean
}

export function useAuth() {
  const config = useAuthConfig()
  const authClient = useAuthClient()
  const debug = config?.debug ?? false

  // Get reactive session from useSession composable
  const { user: sessionUser, isAuthenticated, isPending, error: sessionError, refresh, clear, activeOrganization } = useSession()

  // NOTE (#1712): a `refreshWithOrgRetry` wrapper used to sit here — it called
  // refresh(), then slept and retried up to 3× waiting for activeOrganizationId
  // to appear. It existed because the old `session.create.after` hook wrote the
  // org AFTER the session response was already sent, so the first refresh
  // genuinely couldn't see it. #1703 moved that to `session.create.before`, so
  // the org is present before the session cookie is even written and there is
  // nothing left to wait for. Call sites now use plain refresh().

  if (debug) {
    console.log('[@crouton/auth] useAuth: initialized', {
      hasConfig: !!config,
      hasAuthClient: !!authClient
    })
  }

  // Local state for loading/error during operations
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Reactive state from session
  const user = computed<User | null>(() => sessionUser.value)
  const loggedIn = computed(() => isAuthenticated.value)

  // Capability flags based on config
  const hasPassword = computed(() => {
    const method = config?.methods?.password
    return method !== false && method !== undefined
  })

  const hasOAuth = computed(() => {
    return !!config?.methods?.oauth && Object.keys(config.methods.oauth).length > 0
  })

  const hasPasskeys = computed(() => {
    const method = config?.methods?.passkeys
    return method === true || (typeof method === 'object' && method.enabled !== false)
  })

  const has2FA = computed(() => {
    const method = config?.methods?.twoFactor
    return method === true || (typeof method === 'object' && method.enabled !== false)
  })

  const hasMagicLink = computed(() => {
    const method = config?.methods?.magicLink
    return method === true || (typeof method === 'object' && method.enabled !== false)
  })

  const oauthProviders = computed(() => {
    if (!config?.methods?.oauth) return []
    return Object.keys(config.methods.oauth)
  })

  // ============================================================================
  // Core Auth Methods
  // ============================================================================

  /**
   * Sign in with email and password
   */
  async function login(credentials: LoginCredentials): Promise<void> {
    loading.value = true
    error.value = null

    if (debug) {
      console.log('[@crouton/auth] login: starting login for', credentials.email)
    }

    try {
      const result = await authClient.signIn.email({
        email: credentials.email,
        password: credentials.password,
        rememberMe: credentials.rememberMe
      })

      if (debug) {
        console.log('[@crouton/auth] login: signIn.email result', {
          hasData: !!result.data,
          hasError: !!result.error,
          error: result.error?.message ?? null,
          user: result.data?.user?.email ?? null
        })
      }

      if (result.error) {
        throw new Error(result.error.message ?? 'Login failed')
      }

      if (debug) {
        console.log('[@crouton/auth] login: refreshing session state')
      }

      // Pull the new session into shared state (the server already set its org)
      await refresh()

      if (debug) {
        console.log('[@crouton/auth] login: after refresh', {
          isAuthenticated: isAuthenticated.value,
          user: sessionUser.value?.email ?? null,
          activeOrg: activeOrganization.value?.slug ?? null
        })
      }
    } catch (e: unknown) {
      if (debug) {
        console.error('[@crouton/auth] login: error', e)
      }
      error.value = e instanceof Error ? e.message : 'Login failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Sign in with OAuth provider
   */
  async function loginWithOAuth(provider: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await authClient.signIn.social({
        provider: provider as 'github' | 'google' | 'discord',
        callbackURL: window.location.origin + '/auth/callback'
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'OAuth login failed')
      }

      // OAuth redirects, so we don't need to refresh session here
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'OAuth login failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Login with magic link
   */
  async function loginWithMagicLink(email: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (!hasMagicLink.value) {
        throw new Error('Magic link is not enabled')
      }

      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: window.location.origin + '/auth/callback'
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Magic link failed')
      }

      // Magic link sends email, user clicks link to complete login
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Magic link failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Register a new user with email and password
   */
  async function register(data: RegisterData): Promise<void> {
    loading.value = true
    error.value = null

    if (debug) {
      console.log('[@crouton/auth] register: starting registration for', data.email)
    }

    try {
      // Ensure name is always a string (Better Auth requires it)
      const displayName = (data.name ?? data.email.split('@')[0]) as string
      const result = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: displayName
      })

      if (debug) {
        console.log('[@crouton/auth] register: signUp.email result', {
          hasData: !!result.data,
          hasError: !!result.error,
          error: result.error?.message ?? null,
          user: result.data?.user?.email ?? null
        })
      }

      if (result.error) {
        throw new Error(result.error.message ?? 'Registration failed')
      }

      if (debug) {
        console.log('[@crouton/auth] register: refreshing session state')
      }

      // Pull the new session into shared state (the server already set its org)
      await refresh()

      if (debug) {
        console.log('[@crouton/auth] register: after refresh', {
          isAuthenticated: isAuthenticated.value,
          user: sessionUser.value?.email ?? null,
          activeOrg: activeOrganization.value?.slug ?? null
        })
      }
    } catch (e: unknown) {
      if (debug) {
        console.error('[@crouton/auth] register: error', e)
      }
      error.value = e instanceof Error ? e.message : 'Registration failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Sign out the current user
   */
  async function logout(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await authClient.signOut()
      // Clear session state
      await clear()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Logout failed'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    user: readonly(user),
    loading: readonly(loading),
    error: readonly(error),

    // From session
    isPending,
    sessionError,

    // Computed
    loggedIn,

    // Capability flags
    hasPassword,
    hasOAuth,
    hasPasskeys,
    has2FA,
    hasMagicLink,
    oauthProviders,

    // Core auth methods
    login,
    loginWithOAuth,
    loginWithMagicLink,
    register,
    logout,

    // Session methods
    refreshSession: refresh
  }
}
