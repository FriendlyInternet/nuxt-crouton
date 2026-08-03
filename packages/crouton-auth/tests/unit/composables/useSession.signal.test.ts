/**
 * useSession — $sessionSignal re-entrancy and pending-latch contract (#1703)
 *
 * These tests pin the behaviour behind the kassa "forever spinner": the
 * `$sessionSignal` handler performs a WRITE (`organization.setActive`) from
 * inside a READ handler, and better-auth re-emits `$sessionSignal` on
 * set-active (verified in better-auth 1.5.5:
 * `dist/plugins/organization/client.mjs:79-84` matches
 * `/organization/set-active` → `signal: "$sessionSignal"`).
 *
 * That re-entrancy keeps `isPending` flapping, which keeps re-arming the only
 * effect that can redirect the user after login.
 *
 * NOTE on the driver: `import.meta` is module-scoped, so a test file cannot flip
 * `import.meta.client` inside `useSession.ts` — the `$sessionSignal` listener is
 * therefore never registered under vitest. We drive the identical code path
 * through the public `refresh()` instead: the real signal handler runs
 * `await fetchSession(ctx); await fetchActiveOrg(ctx)` (useSession.ts:304-308) and
 * `refresh()` runs exactly that same pair (useSession.ts:481-482). Re-entrancy is
 * modelled by having the mocked `setActive` re-invoke `refresh()`, which is what
 * better-auth's re-emitted signal does in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

import { useSession } from '../../../app/composables/useSession'

const ORG = { id: 'org-1', name: 'Test 1', slug: 'test1', createdAt: '2024-01-01T00:00:00.000Z' }

// How many times the mocked better-auth client will re-emit $sessionSignal in
// response to a set-active that did NOT opt out via `disableSignal`. Bounded so
// a genuinely re-entrant implementation fails the assertion instead of hanging
// the suite.
const MAX_REEMITS = 3

// Stands in for better-auth's re-emitted `$sessionSignal`: the handler it would
// re-enter does the same fetchSession+fetchActiveOrg pair that `refresh()` does.
let reemit: (() => Promise<void>) | null = null
let reemits = 0

const mockAuthClient = {
  getSession: vi.fn(),
  signOut: vi.fn(),
  organization: {
    getFullOrganization: vi.fn(),
    list: vi.fn(),
    setActive: vi.fn()
  },
  $store: { listen: vi.fn() }
}

const mockUseStateValues: Record<string, ReturnType<typeof ref>> = {}

vi.stubGlobal('useNuxtApp', () => ({ $authClient: mockAuthClient }))
vi.stubGlobal('useAuthClientSafe', () => mockAuthClient)
vi.stubGlobal('useRuntimeConfig', () => ({
  public: { crouton: { auth: { debug: false } } }
}))
vi.stubGlobal('useRequestHeaders', () => ({}))
vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!mockUseStateValues[key]) {
    mockUseStateValues[key] = ref(init ? init() : null)
  }
  return mockUseStateValues[key]
})
vi.stubGlobal('callOnce', vi.fn())
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(null))
vi.stubGlobal('useI18n', () => {
  throw new Error('i18n not available in this test')
})

Object.defineProperty(import.meta, 'server', { value: false, writable: true, configurable: true })

/** Let queued microtasks (the composable's async chains) settle. */
async function flush(times = 12) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('useSession — $sessionSignal re-entrancy (#1703)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockUseStateValues).forEach(k => delete mockUseStateValues[k])
    reemit = null
    reemits = 0

    // The kassa condition: a session with NO active organization.
    mockAuthClient.getSession.mockResolvedValue({
      data: {
        session: { id: 'session-1', userId: 'user-1', activeOrganizationId: null },
        user: { id: 'user-1', email: 'review@example.com' }
      },
      error: null
    })

    // better-auth returns 200 with `data: null` when there is no active org —
    // NOT an error (dist/plugins/organization/routes/crud-org.mjs:321-322).
    mockAuthClient.organization.getFullOrganization.mockResolvedValue({ data: null, error: null })
    mockAuthClient.organization.list.mockResolvedValue({ data: [ORG], error: null })

    // Faithful model of better-auth: set-active re-emits $sessionSignal unless
    // the caller opts out with fetchOptions.disableSignal.
    mockAuthClient.organization.setActive.mockImplementation(async (arg: any) => {
      if (!arg?.fetchOptions?.disableSignal && reemits < MAX_REEMITS && reemit) {
        reemits++
        await reemit()
      }
      return { data: ORG, error: null }
    })
  })

  it('calls setActive with fetchOptions.disableSignal so it cannot re-enter its own handler', async () => {
    const { refresh } = useSession()
    reemit = refresh

    await refresh()
    await flush()

    expect(mockAuthClient.organization.setActive).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: expect.objectContaining({ disableSignal: true })
      })
    )
  })

  it('does not re-enter when set-active re-emits the signal — setActive runs once', async () => {
    const { refresh } = useSession()
    reemit = refresh

    await refresh()
    await flush()

    expect(mockAuthClient.organization.setActive).toHaveBeenCalledTimes(1)
  })

  it('attempts the default-org repair at most once per client lifecycle', async () => {
    const { refresh } = useSession()
    // No re-emission here — three independent signals, each with a session that
    // never gains an org.
    reemit = null

    await refresh()
    await flush()
    await refresh()
    await flush()
    await refresh()
    await flush()

    expect(mockAuthClient.organization.list).toHaveBeenCalledTimes(1)
  })
})

describe('useSession — isPending is a resolved-latch, not an in-flight flag (#1703)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockUseStateValues).forEach(k => delete mockUseStateValues[k])
    reemit = null
    reemits = 0

    mockAuthClient.getSession.mockResolvedValue({
      data: {
        session: { id: 'session-1', userId: 'user-1', activeOrganizationId: 'org-1' },
        user: { id: 'user-1', email: 'review@example.com' }
      },
      error: null
    })
    mockAuthClient.organization.getFullOrganization.mockResolvedValue({ data: ORG, error: null })
    mockAuthClient.organization.list.mockResolvedValue({ data: [ORG], error: null })
    mockAuthClient.organization.setActive.mockResolvedValue({ data: ORG, error: null })
  })

  it('never returns to true once the session has resolved', async () => {
    const { refresh, isPending } = useSession()

    await refresh()
    await flush()
    expect(isPending.value).toBe(false)

    // A background revalidation must NOT re-arm every consumer that treats
    // isPending as "session not resolved yet" (8 of them across the packages).
    const second = refresh()
    expect(isPending.value).toBe(false)
    await second
  })

  it('deduplicates concurrent session fetches into a single request', async () => {
    const { refresh } = useSession()
    mockAuthClient.getSession.mockClear()

    await Promise.all([refresh(), refresh()])
    await flush()

    expect(mockAuthClient.getSession).toHaveBeenCalledTimes(1)
  })
})
