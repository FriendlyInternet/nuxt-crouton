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

// Raw better-auth payloads — normalized into typed shapes by the computeds below
type RawStateRef = Ref<unknown>

/**
 * Everything the session helpers need: the auth client, request context,
 * and the shared refs. Helpers receive the refs themselves (never `.value`)
 * so reactivity is preserved.
 */
interface SessionContext {
  authClient: ReturnType<typeof useAuthClientSafe>
  debug: boolean
  headers: ReturnType<typeof useRequestHeaders> | undefined
  sessionState: RawStateRef
  userState: RawStateRef
  activeOrgState: RawStateRef
  userProfileState: RawStateRef
  isPendingState: Ref<boolean>
  errorState: Ref<Error | null>
  isListening: Ref<boolean>
  triedDefaultOrgState: Ref<boolean>
}

// Client-side single-flight guards (#1703). Login drives three concurrent
// resolution paths — useAuth.login()'s own refresh, the $sessionSignal
// listener, and the initial fetch — which used to fire duplicate requests and
// clobber each other's results.
//
// Deliberately gated on `!import.meta.server`, never touched during SSR: module
// scope on the server is shared across concurrent requests, so caching a promise
// there would leak one visitor's session fetch into another's. On the client one
// module instance == one browser tab, and `callOnce` already dedupes SSR.
let inFlightSession: Promise<void> | null = null
let inFlightActiveOrg: Promise<void> | null = null

// Shared state using useState (works in components, middleware, plugins)
function createSessionState() {
  const sessionState = useState<unknown>('crouton-auth-session', () => null)
  const userState = useState<unknown>('crouton-auth-user', () => null)
  const activeOrgState = useState<unknown>('crouton-auth-active-org', () => null)
  const userProfileState = useState<unknown>('crouton-auth-user-profile', () => null)
  const isPendingState = useState('crouton-auth-pending', () => true)
  const errorState = useState<Error | null>('crouton-auth-error', () => null)

  // Track if we've set up the signal listener (once per app)
  const isListening = useState('crouton-auth-listening', () => false)

  // Whether we've already attempted to repair a session that arrived with no
  // active organization (#1703). One attempt per client lifecycle: an account
  // that genuinely has no team must not retry forever.
  const triedDefaultOrgState = useState('crouton-auth-tried-default-org', () => false)

  return {
    sessionState,
    userState,
    activeOrgState,
    userProfileState,
    isPendingState,
    errorState,
    isListening,
    triedDefaultOrgState
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

// Fetch session from Better Auth.
//
// `isPending` is a RESOLVED-LATCH, not an in-flight flag (#1703): it starts
// true and goes false the first time the session resolves, then never returns
// to true. Every consumer already reads it that way — the auth/guest/team-context
// middleware, crouton-admin's guards, AuthGuard.vue, and the app landing pages
// all use it as "do we know who the user is yet?". Flipping it back to true on
// every background revalidation re-armed all of them at once, which is what let
// a background refetch restart an in-flight navigation.
async function fetchSession(ctx: SessionContext): Promise<void> {
  const { debug, sessionState, userState, isPendingState, errorState } = ctx

  // Single-flight on the client: concurrent callers share one request.
  if (!import.meta.server && inFlightSession) {
    if (debug) {
      console.log('[@crouton/auth] useSession: joining in-flight session fetch')
    }
    return inFlightSession
  }

  if (debug) {
    console.log('[@crouton/auth] useSession: fetching session...')
  }

  errorState.value = null

  const run = (async () => {
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
  })()

  if (import.meta.server) return run

  inFlightSession = run
  try {
    await run
  } finally {
    inFlightSession = null
  }
}

// Fetch active organization
// If no active org is set, try to find and set one automatically.
//
// NOTE: better-auth answers `getFullOrganization` with HTTP 200 and `data: null`
// when no org is active — not an error — so the `!data` branch below is the
// normal path for an org-less session, not an exceptional one.
async function fetchActiveOrg(ctx: SessionContext): Promise<void> {
  if (!import.meta.server && inFlightActiveOrg) return inFlightActiveOrg

  const run = fetchActiveOrgImpl(ctx)
  if (import.meta.server) return run

  inFlightActiveOrg = run
  try {
    await run
  } finally {
    inFlightActiveOrg = null
  }
}

async function fetchActiveOrgImpl(ctx: SessionContext): Promise<void> {
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

// Try to find and set a default organization.
//
// This is a client-side REPAIR for a session that arrived without an active
// organization. Since #1703 the server sets one on `session.create.before`, so
// this should now only fire for sessions created before that fix (they keep a
// null org for up to their 7-day lifetime).
//
// Two hard rules here, both learned from the kassa forever-spinner:
//   1. `setActive` MUST pass `disableSignal` — better-auth re-emits
//      `$sessionSignal` on /organization/set-active, and this function is
//      reached FROM that signal's handler, so without it we re-enter ourselves.
//   2. It runs at most once per client lifecycle — an account that genuinely
//      has no team must not retry on every signal.
async function trySetDefaultOrg(ctx: SessionContext): Promise<void> {
  const { authClient, debug, headers, userState, activeOrgState, triedDefaultOrgState } = ctx

  // Don't try to set org if user is not authenticated (prevents 401 console errors)
  if (!userState.value) return
  if (!authClient?.organization) return
  if (triedDefaultOrgState.value) {
    if (debug) {
      console.log('[@crouton/auth] useSession: default-org repair already attempted, skipping')
    }
    return
  }
  triedDefaultOrgState.value = true

  try {
    // List user's organizations
    const { data: orgs } = await authClient.organization.list({
      fetchOptions: { headers }
    })

    if (debug) {
      console.log('[@crouton/auth] useSession: found orgs', orgs?.length ?? 0)
    }

    if (orgs && orgs.length > 0) {
      // Set the first org as active.
      // `disableSignal` is better-auth's own opt-out (see rule 1 above): without
      // it, this write re-emits $sessionSignal and re-enters the handler that
      // called us.
      const firstOrg = orgs[0]!
      await authClient.organization.setActive({
        organizationId: firstOrg.id,
        fetchOptions: { disableSignal: true }
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

    // Everything below this line is keyed to WHO is signed in, so logout has to
    // tear all of it down. kassa is a shared till: the next person signs in on
    // the same tab with no page reload, and without this they inherit the
    // previous user's state.
    //
    //  - the in-flight promises: otherwise the next login can join the previous
    //    user's still-pending fetch and adopt whatever it resolves to.
    //  - the repair latch: otherwise a second user with a legacy org-less
    //    session never gets the one repair attempt, and lands on "no team found".
    inFlightSession = null
    inFlightActiveOrg = null
    ctx.triedDefaultOrgState.value = false

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
