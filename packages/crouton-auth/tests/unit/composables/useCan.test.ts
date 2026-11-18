/**
 * useCan(action) — asks GET /api/teams/[id]/can through useRequestFetch() (#4104, T8)
 *
 * The browser auth client only exists client-side, so a permission check made
 * during server rendering must go over HTTP with the request's cookie.
 * `useRequestFetch()` is Nuxt's fetch that forwards it; plain `$fetch` would
 * not. The endpoint itself (cookie → session → can()) is covered by
 * tests/unit/server/can-endpoint.test.ts; here Nuxt's useAsyncData is modelled
 * by running the handler immediately, as it does on the server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, isRef, type Ref } from 'vue'

import { useCan } from '../../../app/composables/useCan'

const requestFetch = vi.fn()
const plainFetch = vi.fn()
const teamId = ref<string | null>('team-1')

vi.stubGlobal('computed', computed)
vi.stubGlobal('useTeamContext', () => ({ teamId }))
vi.stubGlobal('useRequestFetch', () => requestFetch)
vi.stubGlobal('$fetch', plainFetch)
vi.stubGlobal('useAsyncData', (key: unknown, handler: () => Promise<unknown>, opts: { default: () => unknown }) => {
  const data: Ref<unknown> = ref(opts.default())
  const resolvedKey = typeof key === 'function' ? key() : isRef(key) ? key.value : key
  const pending = handler().then((v) => { data.value = v })
  return { data, pending, key: resolvedKey }
})

const flush = () => new Promise(r => setTimeout(r, 0))

describe('useCan (T8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    teamId.value = 'team-1'
  })

  it('fetches through useRequestFetch (cookie forwarded), not $fetch, and returns the answer', async () => {
    requestFetch.mockResolvedValue({ 'pages:edit': true })
    const allowed = useCan('pages:edit')
    expect(allowed.value).toBe(false) // nothing yet
    await flush()
    expect(requestFetch).toHaveBeenCalledWith('/api/teams/team-1/can', { query: { actions: 'pages:edit' } })
    expect(plainFetch).not.toHaveBeenCalled()
    expect(allowed.value).toBe(true)
  })

  it('answers false when the endpoint says no', async () => {
    requestFetch.mockResolvedValue({ 'pages:edit': false })
    const allowed = useCan('pages:edit')
    await flush()
    expect(allowed.value).toBe(false)
  })

  it('several actions: true only when every one is allowed', async () => {
    requestFetch.mockResolvedValue({ 'pages:edit': true, 'site:manage': false })
    const allowed = useCan(['pages:edit', 'site:manage'])
    await flush()
    expect(requestFetch).toHaveBeenCalledWith('/api/teams/team-1/can', { query: { actions: 'pages:edit,site:manage' } })
    expect(allowed.value).toBe(false)
  })

  it('no team → no request, false', async () => {
    teamId.value = null
    const allowed = useCan('pages:edit')
    await flush()
    expect(requestFetch).not.toHaveBeenCalled()
    expect(allowed.value).toBe(false)
  })
})
