/**
 * useSession Composable
 *
 * Low-level session management composable using Better Auth client.
 * Provides reactive access to the current session, user, and active organization.
 *
 * Based on atinux's nuxthub-better-auth pattern:
 * - Uses client.getSession() for fetching
 * - Listens to $sessionSignal for automatic updates
 * - Uses useState for shared state across components/middleware/plugins
 *
 * @see https://github.com/atinux/nuxthub-better-auth
 *
 * @example
 * ```vue
 * <script setup>
 * const { session, user, activeOrganization, isPending, isAuthenticated } = useSession()
 * </script>
 * ```
 */
import type { Ref } from 'vue'
import type { Session, User, Team } from '../../types'
import { useAuthClientSafe } from '../../types/auth-client'

export interface SessionData {
  session: Session
  user: User
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = Ref<any>

/**
 * Everything the session helpers need: the auth client, request context,
 * and the shared refs. Helpers receive the refs themselves (never `.value`)
 * so reactivity is preserved.
 */
interface SessionContext {
  authClient: ReturnType<typeof useAuthClientSafe>
  debug: boolean
  headers: ReturnType<typeof useRequestHeaders> | undefined
  sessionState: AnyRef
  userState: AnyRef
  activeOrgState: AnyRef
  userProfileState: AnyRef
  isPendingState: Ref<boolean>
  errorState: Ref<Error | null>
  isListening: Ref<boolean>
}

// Shared state using useState (works in components, middleware, plugins)
function createSessionState() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionState = useState<any>('crouton-auth-session', () => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userState = useState<any>('crouton-auth-user', () => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeOrgState = useState<any>('crouton-auth-active-org', () => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userProfileState = useState<any>('crouton-auth-user-profile', () => null)
  const isPendingState = useState('crouton-auth-pending', () => true)
  const errorState = useState<Error | null>('crouton-auth-error', () => null)

  // Track if we've set up the signal listener (once per app)
  const isListening = useState('crouton-auth-listening', () => false)

  return {
    sessionState,
    userState,
    activeOrgState,
    userProfileState,
    isPendingState,
    errorState,
    isListening
  }
}

// Server-side session fetch: authClient is not available (client-only plugin), use $fetch directly
async function fetchSessionOnServer(ctx: SessionContext): Promise<void> {
  const { debug, headers, sessionState, userState } = ctx

  const requestHeaders = headers ?? {}
  const data = await ($fetch as (url: string, opts?: Record<string, unknown>) => Promise<{ session: unknown; user: unknown } | null>)(
    '/api/auth/get-session',
    { headers: requestHeaders }
  ).catch(() => null)

  sessionState.value = data?.session ?? null
  userState.value = data?.user ?? null

  if (debug) {
    console.log('[@crouton/auth] useSession: server fetched', {
      hasSession: !!data?.session,
      user: (data?.user as Record<string, unknown> | null)?.email ?? null
    })
  }
}

// Client-side session fetch: use Better Auth client
async function fetchSessionOnClient(ctx: SessionContext): Promise<void> {
  const { authClient, debug, headers, sessionState, userState, errorState } = ctx

  if (!authClient) return

  const { data, error } = await authClient.getSession({
    fetchOptions: { headers }
  })

  if (error) {
    if (debug) {
      console.log('[@crouton/auth] useSession: fetch error', error)
    }
    errorState.value = new Error(error.message ?? 'Session error')
    sessionState.value = null
    userState.value = null
  } else {
    sessionState.value = data?.session ?? null
    userState.value = data?.user ?? null

    if (debug) {
      console.log('[@crouton/auth] useSession: fetched', {
        hasSession: !!data?.session,
        user: data?.user?.email ?? null
      })
    }
  }
}

// Fetch session from Better Auth
async function fetchSession(ctx: SessionContext): Promise<void> {
  const { debug, sessionState, userState, isPendingState, errorState } = ctx

  if (debug) {
    console.log('[@crouton/auth] useSession: fetching session...')
  }

  isPendingState.value = true
  errorState.value = null

  try {
    if (import.meta.server) {
      await fetchSessionOnServer(ctx)
    } else {
      await fetchSessionOnClient(ctx)
    }
  } catch (err) {
    console.error('[@crouton/auth] useSession: fetch failed', err)
    errorState.value = err instanceof Error ? err : new Error('Session fetch failed')
    sessionState.value = null
    userState.value = null
  } finally {
    isPendingState.value = false
  }
}

// Fetch active organization
// If no active org is set (400 error), try to find and set one automatically
async function fetchActiveOrg(ctx: SessionContext): Promise<void> {
  const { authClient, debug, headers, userState, activeOrgState } = ctx

  // Don't fetch org data if user is not authenticated (prevents 401 console errors)
  if (!userState.value) return
  if (!authClient?.organization?.getFullOrganization) return

  try {
    const { data, error } = await authClient.organization.getFullOrganization({
      fetchOptions: { headers }
    })

    if (error || !data) {
      // No active org set - try to find and set one (personal/single-tenant mode)
      if (debug) {
        console.log('[@crouton/auth] useSession: no active org, trying to find one...')
      }
      await trySetDefaultOrg(ctx)
      return
    }

    activeOrgState.value = data

    if (debug) {
      console.log('[@crouton/auth] useSession: fetched active org', {
        org: data?.slug ?? null
      })
    }
  } catch (err) {
    if (debug) {
      console.log('[@crouton/auth] useSession: getFullOrganization failed, trying to find org', err)
    }
    // Try to find and set an org
    await trySetDefaultOrg(ctx)
  }
}

// Try to find and set a default organization (for personal/single-tenant modes)
async function trySetDefaultOrg(ctx: SessionContext): Promise<void> {
  const { authClient, debug, headers, userState, activeOrgState } = ctx

  // Don't try to set org if user is not authenticated (prevents 401 console errors)
  if (!userState.value) return
  if (!authClient?.organization) return

  try {
    // List user's organizations
    const { data: orgs } = await authClient.organization.list({
      fetchOptions: { headers }
    })

    if (debug) {
      console.log('[@crouton/auth] useSession: found orgs', orgs?.length ?? 0)
    }

    if (orgs && orgs.length > 0) {
      // Set the first org as active
      const firstOrg = orgs[0]!
      await authClient.organization.setActive({
        organizationId: firstOrg.id
      })

      if (debug) {
        console.log('[@crouton/auth] useSession: set active org to', firstOrg.slug)
      }

      // Now fetch the full org data
      const { data: fullOrg } = await authClient.organization.getFullOrganization({
        fetchOptions: { headers }
      })

      activeOrgState.value = fullOrg ?? null
    }
  } catch (err) {
    if (debug) {
      console.log('[@crouton/auth] useSession: failed to set default org', err)
    }
    activeOrgState.value = null
  }
}

// Fetch user profile (locale, timezone, etc.) — separate from session
async function fetchUserProfile(ctx: SessionContext): Promise<void> {
  const { debug, headers, userState, userProfileState } = ctx

  if (!userState.value) return

  try {
    const profile = await $fetch('/api/users/me/profile', {
      headers: headers as Record<string, string> | undefined,
    })
    userProfileState.value = profile

    // Auto-apply saved locale on login
    if (import.meta.client && profile && (profile as Record<string, unknown>).locale) {
      try {
        const { setLocale } = useI18n()
        setLocale((profile as Record<string, unknown>).locale as any)
      } catch {
        // i18n not available — skip
      }
    }

    if (debug) {
      console.log('[@crouton/auth] useSession: fetched user profile', {
        locale: (profile as Record<string, unknown>)?.locale ?? null,
      })
    }
  } catch {
    // Profile not found or endpoint not available — that's fine
    userProfileState.value = null
  }
}

// Update user profile fields
async function updateUserProfileImpl(ctx: SessionContext, data: { locale?: string | null }): Promise<void> {
  if (!ctx.userState.value) return

  try {
    const profile = await $fetch('/api/users/me/profile', {
      method: 'PATCH',
      body: data,
    })
    ctx.userProfileState.value = profile
  } catch (err) {
    console.warn('[@crouton/auth] useSession: failed to update user profile', err)
  }
}

// Set up the client signal listener (once per app lifecycle) + initial fetches,
// and the server-side one-time SSR fetch
function setupSessionSync(ctx: SessionContext): void {
  const { authClient, debug, userState, isPendingState, isListening } = ctx

  if (import.meta.client && authClient && !isListening.value) {
    isListening.value = true

    if (debug) {
      console.log('[@crouton/auth] useSession: setting up signal listener')
    }

    // Listen to session signal for automatic updates
    // This fires when session changes (login, logout, token refresh)
    authClient.$store?.listen?.('$sessionSignal', async (signal: unknown) => {
      if (!signal) return

      if (debug) {
        console.log('[@crouton/auth] useSession: session signal received')
      }

      await fetchSession(ctx)
      // Only fetch org and profile if user is authenticated (prevents 401 console errors)
      if (userState.value) {
        await fetchActiveOrg(ctx)
        await fetchUserProfile(ctx)
      }
    })

    // Initial fetch - only fetch org and profile if session exists
    fetchSession(ctx).then(() => {
      if (userState.value) {
        fetchActiveOrg(ctx)
        fetchUserProfile(ctx)
      }
    })
  }

  // On server, try to fetch session if we have headers
  if (import.meta.server && isPendingState.value) {
    // Use callOnce to avoid duplicate fetches during SSR
    callOnce('crouton-auth-ssr-fetch', async () => {
      await fetchSession(ctx)
      // Only fetch org and profile if user is authenticated (prevents 401 console errors)
      if (userState.value) {
        await fetchActiveOrg(ctx)
        await fetchUserProfile(ctx)
      }
    })
  }
}

// Normalize the raw Better Auth organization payload into a Team
function mapActiveOrganization(rawOrg: unknown): Team {
  const org = rawOrg as {
    id: string
    name: string
    slug: string
    logo?: string | null
    metadata?: string | Record<string, unknown> | null
    personal?: boolean | number | null
    isDefault?: boolean | number | null
    ownerId?: string | null
    createdAt: string | Date
  }

  // Parse metadata if it's a string
  let metadata: Record<string, unknown> = {}
  if (org.metadata) {
    try {
      metadata = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata
    } catch {
      metadata = {}
    }
  }

  // SQLite returns 0/1 for booleans
  const isPersonal = org.personal === true || org.personal === 1 || metadata.personal === true
  const isDefaultOrg = org.isDefault === true || org.isDefault === 1 || metadata.isDefault === true

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo ?? null,
    metadata,
    personal: isPersonal,
    isDefault: isDefaultOrg,
    ownerId: org.ownerId ?? (metadata.ownerId as string | undefined),
    createdAt: new Date(org.createdAt),
    updatedAt: new Date(org.createdAt)
  }
}

// Computed accessors for cleaner API
function createSessionComputeds(ctx: SessionContext) {
  const { sessionState, userState, activeOrgState, userProfileState, isPendingState, errorState } = ctx

  const session = computed<Session | null>(() => {
    if (!sessionState.value) return null
    const s = sessionState.value as Record<string, unknown>
    return {
      id: s.id as string,
      token: s.token as string,
      userId: s.userId as string,
      expiresAt: new Date(s.expiresAt as string | Date),
      ipAddress: s.ipAddress as string | undefined,
      userAgent: s.userAgent as string | undefined,
      activeOrganizationId: s.activeOrganizationId as string | undefined,
      createdAt: new Date((s.createdAt as string | Date) ?? Date.now()),
      updatedAt: new Date((s.updatedAt as string | Date) ?? Date.now())
    } satisfies Session
  })

  const user = computed<User | null>(() => {
    if (!userState.value) return null
    const u = userState.value as Record<string, unknown>
    return {
      id: u.id as string,
      email: u.email as string,
      name: (u.name as string | null) ?? null,
      image: (u.image as string | null) ?? null,
      emailVerified: (u.emailVerified as boolean) ?? false,
      createdAt: new Date(u.createdAt as string | Date),
      updatedAt: new Date(u.updatedAt as string | Date)
    } satisfies User
  })

  const activeOrganization = computed<Team | null>(() => {
    if (!activeOrgState.value) return null
    return mapActiveOrganization(activeOrgState.value)
  })

  const userLocale = computed<string | null>(() => {
    return (userProfileState.value as Record<string, unknown> | null)?.locale as string | null ?? null
  })

  const isPending = computed(() => isPendingState.value)
  const error = computed(() => errorState.value)
  const isAuthenticated = computed(() => !!userState.value)

  // Expose sessionData for backward compatibility
  const sessionData = computed(() => {
    if (!sessionState.value && !userState.value) return null
    return {
      session: sessionState.value,
      user: userState.value
    }
  })

  // Raw active org state (includes members from getFullOrganization)
  const activeOrgRaw = computed(() => activeOrgState.value)

  return {
    session,
    user,
    activeOrganization,
    userLocale,
    isPending,
    error,
    isAuthenticated,
    sessionData,
    activeOrgRaw
  }
}

export function useSession() {
  const authClient = useAuthClientSafe()
  const config = useRuntimeConfig()
  const debug = (config.public?.crouton?.auth as { debug?: boolean } | undefined)?.debug ?? false
  const headers = import.meta.server ? useRequestHeaders() : undefined

  const ctx: SessionContext = {
    authClient,
    debug,
    headers,
    ...createSessionState()
  }

  setupSessionSync(ctx)

  const {
    session,
    user,
    activeOrganization,
    userLocale,
    isPending,
    error,
    isAuthenticated,
    sessionData,
    activeOrgRaw
  } = createSessionComputeds(ctx)

  // Methods
  async function refresh(): Promise<void> {
    if (debug) {
      console.log('[@crouton/auth] useSession: refresh called')
    }
    await fetchSession(ctx)
    await fetchActiveOrg(ctx)
  }

  async function clear(): Promise<void> {
    if (authClient) {
      await authClient.signOut()
    }
    ctx.sessionState.value = null
    ctx.userState.value = null
    ctx.activeOrgState.value = null
    ctx.userProfileState.value = null
  }

  async function updateUserProfile(data: { locale?: string | null }): Promise<void> {
    return updateUserProfileImpl(ctx, data)
  }

  // Convenience: update user locale
  async function updateUserLocale(locale: string): Promise<void> {
    return updateUserProfile({ locale })
  }

  return {
    // Raw data (for advanced use)
    data: sessionData,

    // Computed accessors (recommended)
    session,
    user,
    activeOrganization,

    // Raw active org with members (for role checking)
    activeOrgRaw,

    // User profile
    userLocale,

    // Status
    isPending,
    error,
    isAuthenticated,

    // Methods
    refresh,
    clear,
    updateUserProfile,
    updateUserLocale
  }
}
