/**
 * Scoped Access Composable
 *
 * Client-side composable for managing scoped access tokens.
 * Used for lightweight, resource-scoped authentication scenarios like:
 * - Event helpers (POS/sales)
 * - Guest access to bookings
 * - Temporary attendee access
 *
 * @example
 * ```vue
 * <script setup>
 * const {
 *   isAuthenticated,
 *   displayName,
 *   resourceId,
 *   login,
 *   logout
 * } = useScopedAccess('event')
 *
 * async function handleLogin(pin: string, name: string) {
 *   await login({ pin, displayName: name, resourceId: eventId })
 * }
 * </script>
 * ```
 */

export interface ScopedAccessSession {
  token: string
  displayName: string
  organizationId: string
  resourceType: string
  resourceId: string
  role: string
  expiresAt: string
}

export interface ScopedAccessLoginOptions {
  /** Login endpoint URL */
  loginEndpoint: string
  /** Request body for login */
  body: Record<string, unknown>
}

export interface ScopedAccessRedeemOptions {
  /** Team ID or slug */
  teamId: string
  /** Resource ID to gain access to */
  resourceId: string
  /** The credential (PIN) */
  secret: string
  /** Display name for the token holder */
  displayName: string
  /** Credential presentation type (default: 'pin') */
  credentialType?: string
}

export interface UseScopedAccessOptions {
  /** Cookie name for storing the token (default: 'scoped-access-token') */
  cookieName?: string
  /** Cookie name for session data (default: `scoped-access-session-${resourceType}`) */
  storageKey?: string
  /** Fallback cookie max age in seconds when the session has no usable expiresAt (default: 8 hours) */
  cookieMaxAge?: number
}

/**
 * Composable for managing scoped access authentication
 *
 * @param resourceType - Type of resource this access is for (e.g., 'event')
 * @param options - Configuration options
 */
export function useScopedAccess(
  resourceType: string,
  options: UseScopedAccessOptions = {}
) {
  const {
    cookieName = 'scoped-access-token',
    // Keyed per resourceType so every consumer of the same resource type
    // (generic gate, useEventAccess, …) lands on the same session.
    storageKey = `scoped-access-session-${resourceType}`,
    cookieMaxAge = 60 * 60 * 8 // 8 hours
  } = options

  // The session cookie's lifetime must follow the token's real expiresAt —
  // a fixed maxAge would keep a dead token's session alive (or expire a
  // live one early) when a grant uses a non-default tokenTtl.
  const sessionMaxAge = (data: ScopedAccessSession | null): number => {
    if (!data?.expiresAt) return cookieMaxAge
    const remaining = Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000)
    return remaining > 0 ? remaining : cookieMaxAge
  }

  // Persist session in cookie for SSR compatibility (replaces localStorage).
  // Created fresh per write so maxAge can track the session's expiresAt.
  const sessionCookie = (maxAge: number) =>
    useCookie<ScopedAccessSession | null>(storageKey, {
      maxAge,
      default: () => null
    })

  // State
  const session = useState<ScopedAccessSession | null>(`scoped-access-${resourceType}`, () => null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const errorStatus = ref<number | null>(null)

  // Computed properties
  const isAuthenticated = computed(() => {
    if (!session.value) return false
    // Check if expired
    if (new Date(session.value.expiresAt) < new Date()) {
      clearSession()
      return false
    }
    return true
  })

  const token = computed(() => session.value?.token || '')

  /**
   * Headers for authenticated API calls — canonical scoped-token header.
   * Spread into $fetch options: `$fetch(url, { headers: authHeaders.value })`
   */
  const authHeaders = computed<Record<string, string>>(() => {
    const headers: Record<string, string> = {}
    if (session.value?.token) {
      headers['x-scoped-token'] = session.value.token
    }
    return headers
  })
  const displayName = computed(() => session.value?.displayName || '')
  const organizationId = computed(() => session.value?.organizationId || '')
  const resourceId = computed(() => session.value?.resourceId || '')
  const role = computed(() => session.value?.role || '')
  const expiresAt = computed(() => session.value?.expiresAt ? new Date(session.value.expiresAt) : null)

  /**
   * Load session from cookie
   */
  function loadSession(): ScopedAccessSession | null {
    try {
      const data = sessionCookie(cookieMaxAge).value
      if (!data) return null

      // Validate resource type matches
      if (data.resourceType !== resourceType) return null

      // Check if expired
      if (new Date(data.expiresAt) < new Date()) {
        clearSession()
        return null
      }

      session.value = data
      return data
    }
    catch {
      clearSession()
      return null
    }
  }

  /**
   * Save session to cookies
   */
  function saveSession(data: ScopedAccessSession): void {
    session.value = data
    const maxAge = sessionMaxAge(data)
    sessionCookie(maxAge).value = data

    // Also set token cookie for server-side validation. Note: when the
    // server already set its httpOnly copy (redeem/mint), this write is a
    // silent no-op — the httpOnly cookie wins and JS can never clear it.
    const tokenCookie = useCookie(cookieName, { maxAge })
    tokenCookie.value = data.token
  }

  /**
   * Clear session from state and cookies
   */
  function clearSession(): void {
    session.value = null
    sessionCookie(cookieMaxAge).value = null

    const tokenCookie = useCookie(cookieName)
    tokenCookie.value = null
  }

  /**
   * Login with scoped access
   *
   * Makes a request to the specified login endpoint and stores the returned session.
   *
   * @param loginOptions - Login endpoint and request body
   * @returns True if login succeeded
   */
  async function login(loginOptions: ScopedAccessLoginOptions): Promise<boolean> {
    isLoading.value = true
    error.value = null
    errorStatus.value = null

    try {
      const response = await $fetch<{
        token: string
        displayName?: string
        helperName?: string // For backwards compatibility
        organizationId?: string
        teamId?: string // For backwards compatibility
        resourceId?: string
        eventId?: string // For backwards compatibility
        role?: string
        expiresAt: string
      }>(loginOptions.loginEndpoint, {
        method: 'POST',
        body: loginOptions.body
      })

      // Build session from response (support both new and legacy field names)
      const sessionData: ScopedAccessSession = {
        token: response.token,
        displayName: response.displayName || response.helperName || 'Guest',
        organizationId: response.organizationId || response.teamId || '',
        resourceType,
        resourceId: response.resourceId || response.eventId || '',
        role: response.role || 'guest',
        expiresAt: response.expiresAt
      }

      saveSession(sessionData)
      return true
    }
    catch (err: unknown) {
      const fetchError = err as { status?: number; statusCode?: number; data?: { message?: string; statusMessage?: string }; statusMessage?: string }
      error.value = fetchError.data?.message || fetchError.data?.statusMessage || fetchError.statusMessage || 'Login failed'
      errorStatus.value = fetchError.status ?? fetchError.statusCode ?? null
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Redeem a credential (PIN) against the generic grant endpoint
   *
   * Wraps login() with the canonical /api/auth/scoped-access/redeem endpoint;
   * resourceType comes from the composable.
   *
   * @returns True if redemption succeeded
   */
  async function redeem(redeemOptions: ScopedAccessRedeemOptions): Promise<boolean> {
    return login({
      loginEndpoint: '/api/auth/scoped-access/redeem',
      body: { ...redeemOptions, resourceType }
    })
  }

  /**
   * Logout and clear session
   */
  async function logout(): Promise<void> {
    // Await the server revoke + httpOnly-cookie clear before clearing local
    // state. The httpOnly scoped-access-token cookie can only be cleared by a
    // server Set-Cookie (client JS can't touch it), and SSR re-gates only once
    // that lands — so this must not be fire-and-forget. The endpoint falls back
    // to the cookie when no token is sent, so logout still clears it even if
    // the in-memory session was already lost.
    try {
      await $fetch('/api/auth/scoped-access/logout', {
        method: 'POST',
        body: session.value?.token ? { token: session.value.token } : {}
      })
    }
    catch {
      // Ignore — local state is cleared regardless.
    }

    clearSession()
  }

  /**
   * Validate current session with server
   *
   * @returns True if session is valid
   */
  async function validateSession(): Promise<boolean> {
    if (!session.value?.token) return false

    try {
      const response = await $fetch<{ valid: boolean }>('/api/auth/scoped-access/validate', {
        method: 'POST',
        body: { token: session.value.token }
      })
      return response.valid
    }
    catch {
      clearSession()
      return false
    }
  }

  /**
   * Refresh session expiration.
   *
   * The new expiry is governed server-side by the token's GRANT policy (its
   * tokenTtl) — the client no longer chooses the duration, and the token is sent
   * via the canonical `x-scoped-token` header rather than the body.
   *
   * @param _additionalHours - retained for backward compatibility; ignored.
   * @returns True if refresh succeeded
   */
  async function refreshSession(_additionalHours = 8): Promise<boolean> {
    if (!session.value?.token) return false

    try {
      const response = await $fetch<{ expiresAt: string }>('/api/auth/scoped-access/refresh', {
        method: 'POST',
        headers: { 'x-scoped-token': session.value.token }
      })

      if (response.expiresAt) {
        session.value = {
          ...session.value,
          expiresAt: response.expiresAt
        }
        saveSession(session.value)
        return true
      }
      return false
    }
    catch {
      return false
    }
  }

  // Initialize session from cookie (SSR-safe)
  loadSession()

  return {
    // State
    session: readonly(session),
    isLoading: readonly(isLoading),
    error: readonly(error),
    errorStatus: readonly(errorStatus),

    // Computed
    isAuthenticated,
    token,
    authHeaders,
    displayName,
    organizationId,
    resourceId,
    role,
    expiresAt,

    // Methods
    login,
    redeem,
    logout,
    loadSession,
    clearSession,
    validateSession,
    refreshSession
  }
}

/**
 * Shorthand for event-scoped access (POS helpers)
 *
 * Uses the canonical 'scoped-access-token' cookie so server-side checks
 * (e.g. crouton-pages' scoped visibility) see the token during SSR.
 * No storageKey override: the session lands on the shared
 * 'scoped-access-session-event' key, same as `useScopedAccess('event')`.
 */
export function useEventAccess(options?: Omit<UseScopedAccessOptions, 'storageKey'>) {
  return useScopedAccess('event', options)
}

/**
 * Shorthand for booking-scoped access
 */
export function useBookingAccess(options?: Omit<UseScopedAccessOptions, 'storageKey'>) {
  return useScopedAccess('booking', options)
}
