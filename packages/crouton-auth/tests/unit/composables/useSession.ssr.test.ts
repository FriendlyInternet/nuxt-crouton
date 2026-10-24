/**
 * useSession — the active organization must resolve during SSR (#2274)
 *
 * `$authClient` comes from a CLIENT-ONLY plugin, so during SSR it is undefined.
 * `fetchSessionOnServer` already falls back to `$fetch` for the session, but the
 * active-org fetch did not — it returned early, so `activeOrgRaw` (and therefore
 * the member role) was null on every server render. Admin-only controls rendered
 * disabled, and hydration kept those classes.
 *
 * Driver: `import.meta.server` is module-scoped and can't be flipped from a test
 * (see useSession.signal.test.ts), so we model SSR by its real precondition — no
 * auth client — and drive the fetch through the public `refresh()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

import { useSession } from '../../../app/composables/useSession'

const USER = { id: 'user-1', email: 'admin@example.com' }
const FULL_ORG = {
  id: 'org-1',
  name: 'Test 1',
  slug: 'test1',
  createdAt: '2024-01-01T00:00:00.000Z',
  members: [{ userId: 'user-1', role: 'admin' }]
}

const mockUseStateValues: Record<string, ReturnType<typeof ref>> = {}
const mockFetch = vi.fn()

vi.stubGlobal('useNuxtApp', () => ({ $authClient: undefined }))
vi.stubGlobal('useRuntimeConfig', () => ({
  public: { crouton: { auth: { debug: false } } }
}))
vi.stubGlobal('useRequestHeaders', () => ({ cookie: 'better-auth.session_token=abc' }))
vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!mockUseStateValues[key]) {
    mockUseStateValues[key] = ref(init ? init() : null)
  }
  return mockUseStateValues[key]
})
vi.stubGlobal('callOnce', vi.fn())
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('$fetch', mockFetch)

describe('useSession without an auth client (SSR)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockUseStateValues).forEach(key => delete mockUseStateValues[key])
    // The session itself resolved server-side (fetchSessionOnServer).
    mockUseStateValues['crouton-auth-user'] = ref(USER)
  })

  it('fetches the full active organization over HTTP, forwarding the request cookie', async () => {
    mockFetch.mockResolvedValue(FULL_ORG)

    const { refresh } = useSession()
    await refresh()

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/organization/get-full-organization',
      expect.objectContaining({ headers: expect.objectContaining({ cookie: 'better-auth.session_token=abc' }) })
    )
  })

  it('exposes the members array so the role is known on the server render', async () => {
    mockFetch.mockResolvedValue(FULL_ORG)

    const { refresh, activeOrgRaw, activeOrganization } = useSession()
    await refresh()

    expect(activeOrganization.value?.slug).toBe('test1')
    expect((activeOrgRaw.value as typeof FULL_ORG).members).toEqual([{ userId: 'user-1', role: 'admin' }])
  })

  it('leaves the active org null when the user has none (no write attempted)', async () => {
    mockFetch.mockResolvedValue(null)

    const { refresh, activeOrgRaw } = useSession()
    await refresh()

    expect(activeOrgRaw.value).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not fetch the org for an anonymous visitor', async () => {
    mockUseStateValues['crouton-auth-user'] = ref(null)

    const { refresh } = useSession()
    await refresh()

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
