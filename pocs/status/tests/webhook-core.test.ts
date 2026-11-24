import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import * as crypto from 'node:crypto'
import { createStorage } from 'unstorage'
import memory from 'unstorage/drivers/memory'
import {
  DIRTY_KEY, DIRTY_MARGIN_MS, REMARK_MS, handleWebhook, isDirty, parseWebhook, shouldMark, verifySignature
} from '../server/utils/webhook-core'

// #4309: the GitHub webhook receiver marks "something changed" in KV; the clock does the sync.
// Drives the REAL handleWebhook against a real (in-memory) unstorage.

vi.mock('node:crypto', async (orig) => {
  const real = await orig<typeof import('node:crypto')>()
  return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) }
})

const SECRET = 's3cret'
const REPO = 'FriendlyInternet/nuxt-crouton'
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ action: 'opened', issue: { number: 7 }, repository: { full_name: REPO }, ...over })
const headers = (raw: string, event = 'issues', sig: string | undefined = sign(raw)) => ({ 'x-github-event': event, 'x-hub-signature-256': sig })

function spyStore() {
  const kv = createStorage({ driver: memory() })
  const store = {
    getItem: vi.fn((k: string) => kv.getItem(k)),
    setItem: vi.fn((k: string, v: string) => kv.setItem(k, v))
  }
  return { kv, store }
}

const NOW = Date.parse('2026-11-19T10:00:00Z')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('T1 — signature', () => {
  // covers: T1
  it('a wrong signature, a missing header or an empty secret → 401, nothing stored', async () => {
    const raw = body()
    const cases = [
      { h: headers(raw, 'issues', sign(raw, 'other')), secret: SECRET },
      { h: { 'x-github-event': 'issues' }, secret: SECRET },
      { h: headers(raw, 'issues', 'sha1=abc'), secret: SECRET },
      { h: headers(raw), secret: '' }
    ]
    for (const c of cases) {
      const { store } = spyStore()
      expect(await handleWebhook({ headers: c.h, rawBody: raw, secret: c.secret, repo: REPO, store, now: NOW })).toEqual({ status: 401 })
      expect(store.getItem).not.toHaveBeenCalled()
      expect(store.setItem).not.toHaveBeenCalled()
    }
  })

  // covers: T1
  it('a valid HMAC is accepted, compared through timingSafeEqual', () => {
    const raw = body()
    expect(verifySignature(raw, sign(raw), SECRET)).toBe(true)
    expect(crypto.timingSafeEqual).toHaveBeenCalled()
    expect(verifySignature(raw + ' ', sign(raw), SECRET)).toBe(false)
  })

  // covers: T1
  it('a signed body that is not JSON → 400', () => {
    expect(parseWebhook(headers('nope', 'issues', sign('nope')), 'nope', SECRET)).toEqual({ ok: false, status: 400 })
  })

  // covers: T1
  it('parseWebhook reads event, action, number, isPr and repo', () => {
    const raw = body({ issue: { number: 9, pull_request: {} } })
    expect(parseWebhook(headers(raw, 'issue_comment'), raw, SECRET)).toEqual({ ok: true, event: 'issue_comment', action: 'opened', number: 9, isPr: true, repo: REPO, board: null })
  })
})

describe('T2 — events', () => {
  // covers: T2
  it('another repo → 204, no write; ping → 200, no write', async () => {
    const { store } = spyStore()
    const other = body({ repository: { full_name: 'someone/else' } })
    expect(await handleWebhook({ headers: headers(other), rawBody: other, secret: SECRET, repo: REPO, store, now: NOW })).toEqual({ status: 204 })
    const ping = JSON.stringify({ zen: 'hi', repository: { full_name: REPO } })
    expect(await handleWebhook({ headers: headers(ping, 'ping'), rawBody: ping, secret: SECRET, repo: REPO, store, now: NOW })).toEqual({ status: 200 })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  // covers: T2
  it('issues, issue_comment, pull_request and pull_request_review → 202 and set cards-sync:dirty-at; push → 204', async () => {
    for (const ev of ['issues', 'issue_comment', 'pull_request', 'pull_request_review']) {
      const { kv, store } = spyStore()
      const raw = body()
      expect(await handleWebhook({ headers: headers(raw, ev), rawBody: raw, secret: SECRET, repo: REPO, store, now: NOW })).toEqual({ status: 202 })
      expect(await kv.getItem(DIRTY_KEY)).toBe(new Date(NOW).toISOString())
    }
    const { store } = spyStore()
    const raw = body()
    expect(await handleWebhook({ headers: headers(raw, 'push'), rawBody: raw, secret: SECRET, repo: REPO, store, now: NOW })).toEqual({ status: 204 })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  // covers: T2
  it('two events 1 s apart write once; an event 5 min after the mark writes again; never calls fetch', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    vi.stubGlobal('$fetch', f)
    const { kv, store } = spyStore()
    const raw = body()
    const send = (now: number) => handleWebhook({ headers: headers(raw), rawBody: raw, secret: SECRET, repo: REPO, store, now })
    await send(NOW)
    await send(NOW + 1_000)
    expect(store.setItem).toHaveBeenCalledTimes(1)
    await send(NOW + REMARK_MS)
    expect(store.setItem).toHaveBeenCalledTimes(2)
    expect(await kv.getItem(DIRTY_KEY)).toBe(new Date(NOW + REMARK_MS).toISOString())
    expect(f).not.toHaveBeenCalled()
  })
})

describe('T3 — isDirty / shouldMark under a stale read', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const S = Date.parse('2026-11-19T10:20:00Z') // the last sync's start

  // covers: T3
  it('a webhook after synced-from that skips its write on a mark up to 5 min old still leaves the clock dirty', () => {
    for (const e of [S + 1, S + 30_000, S + 4 * 60_000]) {
      // The worst stale read: the mark is just under REMARK_MS older than the event.
      const seen = e - REMARK_MS + 1
      expect(shouldMark(iso(seen), e)).toBe(false) // the webhook skips its write
      expect(isDirty(iso(seen), iso(S))).toBe(true) // …and the stored mark is still dirty
    }
  })

  // covers: T3
  it('dirty-at more than 6 min before synced-from → clean; no dirty-at → clean; no synced-from → dirty', () => {
    expect(isDirty(iso(S - DIRTY_MARGIN_MS - 1), iso(S))).toBe(false)
    expect(isDirty(null, iso(S))).toBe(false)
    expect(isDirty(undefined, undefined)).toBe(false)
    expect(isDirty(iso(S), null)).toBe(true)
  })

  // covers: T3
  it('shouldMark: missing or unparseable → true; < 5 min old → false; ≥ 5 min → true', () => {
    expect(shouldMark(null, NOW)).toBe(true)
    expect(shouldMark('garbage', NOW)).toBe(true)
    expect(shouldMark(iso(NOW - REMARK_MS + 1), NOW)).toBe(false)
    expect(shouldMark(iso(NOW - REMARK_MS), NOW)).toBe(true)
  })
})
