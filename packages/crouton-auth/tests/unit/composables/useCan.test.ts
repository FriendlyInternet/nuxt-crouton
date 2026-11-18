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
import { ref, computed, isRef, watch, type Ref, type WatchSource } from 'vue'

import { useCanAnswers } from '../../../app/composables/useCanAnswers'
import { useCan } from '../../../app/composables/useCan'

const requestFetch = vi.fn()
const plainFetch = vi.fn()
const teamId = ref<string | null>('team-1')

vi.stubGlobal('computed', computed)
vi.stubGlobal('useTeamContext', () => ({ teamId }))
vi.stubGlobal('useRequestFetch', () => requestFetch)
vi.stubGlobal('$fetch', plainFetch)
const state: Record<string, Ref<unknown>> = {}
vi.stubGlobal('useState', (key: string, init: () => unknown) => (state[key] ??= ref(init())))
// Like Nuxt: run the handler now and again when a `watch` source changes; the
// old value stays in `data` until the new request resolves.
let lastKey: unknown
let lastOpts: Record<string, unknown> | undefined
const stops: Array<() => void> = []
vi.stubGlobal('useAsyncData', (key: unknown, handler: () => Promise<unknown>, opts: { default: () => unknown, watch?: WatchSource[] }) => {
  const data: Ref<unknown> = ref(opts.default())
  lastKey = key
  lastOpts = opts as Record<string, unknown>
  const resolvedKey = typeof key === 'function' ? key() : isRef(key) ? key.value : key
  const run = () => handler().then((v) => {
    data.value = v
  })
  const pending = run()
  if (opts.watch) stops.push(watch(opts.watch, () => run(), { flush: 'sync' }))
  return { data, pending, key: resolvedKey }
})

const flush = () => new Promise(r => setTimeout(r, 0))

describe('useCan (T8)', () => {
  beforeEach(() => {
    stops.splice(0).forEach(stop => stop()) // the previous test's watchers
    vi.clearAllMocks()
    teamId.value = 'team-1'
    Object.keys(state).forEach(k => delete state[k])
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

  it('uses a plain string key (reactive keys need Nuxt ≥3.17; the peer range allows 3.14)', () => {
    requestFetch.mockResolvedValue({})
    useCan('pages:edit')
    expect(typeof lastKey).toBe('string')
  })

  it('a team switch from allowed to denied answers false while the new answer is still loading', async () => {
    requestFetch.mockResolvedValueOnce({ 'pages:edit': true })
    const allowed = useCan('pages:edit')
    await flush()
    expect(allowed.value).toBe(true)

    let resolveSecond!: (v: unknown) => void
    requestFetch.mockReturnValueOnce(new Promise((r) => {
      resolveSecond = r
    }))
    teamId.value = 'team-2'
    await flush()
    expect(requestFetch).toHaveBeenLastCalledWith('/api/teams/team-2/can', { query: { actions: 'pages:edit' } })
    expect(allowed.value).toBe(false) // team-1's "yes" must not show in team-2

    resolveSecond({ 'pages:edit': false })
    await flush()
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

// T4 (#4105): browser-only answers for shared-cached public pages, and the
// shared answer store useTeam() reads.
describe('useCan options + answer store (T4, #4105)', () => {
  beforeEach(() => {
    stops.splice(0).forEach(stop => stop())
    vi.clearAllMocks()
    teamId.value = 'team-1'
    Object.keys(state).forEach(k => delete state[k])
  })

  it('{ server: false } passes server:false to useAsyncData under a different key', () => {
    requestFetch.mockResolvedValue({})
    useCan('pages:edit', { server: false })
    expect(lastOpts?.server).toBe(false)
    expect(lastKey).toBe('crouton-can:pages:edit:client')
  })

  it('the default call is unchanged (no server option, plain key)', () => {
    requestFetch.mockResolvedValue({})
    useCan('pages:edit')
    expect(lastOpts && 'server' in lastOpts).toBe(false)
    expect(lastKey).toBe('crouton-can:pages:edit')
  })

  it('an answer is written into useCanAnswers() under the team id it asked for', async () => {
    requestFetch.mockResolvedValueOnce({ 'team:manage': true })
    useCan('team:manage')
    await flush()
    requestFetch.mockResolvedValueOnce({ 'site:manage': false })
    useCan('site:manage')
    await flush()
    expect(useCanAnswers().value).toEqual({ 'team-1': { 'team:manage': true, 'site:manage': false } })
  })
})
