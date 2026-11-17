import { describe, it, expect, vi } from 'vitest'
import { buildReply, postReply } from '../server/utils/reply-core'
import { isOwnerSession } from '../server/utils/github-core'

describe('buildReply', () => {
  it('maps ok to exactly "ok" (never lgtm)', () => {
    expect(buildReply({ kind: 'issue', number: 5, verdict: 'ok' }).data).toEqual({ kind: 'issue', number: 5, body: 'ok' })
  })
  it('maps not-ok to "not ok: <note>" and requires a note', () => {
    expect(buildReply({ kind: 'pr', number: 7, verdict: 'not-ok', note: ' fix x ' }).data?.body).toBe('not ok: fix x')
    expect(buildReply({ kind: 'pr', number: 7, verdict: 'not-ok' }).error).toMatch(/note/)
    expect(buildReply({ kind: 'pr', number: 7, verdict: 'not-ok', note: '  ' }).error).toMatch(/note/)
  })
  it('rejects bad kind, number and verdict', () => {
    expect(buildReply({ kind: 'x', number: 1, verdict: 'ok' }).error).toBeTruthy()
    expect(buildReply({ kind: 'issue', number: 0, verdict: 'ok' }).error).toBeTruthy()
    expect(buildReply({ kind: 'issue', number: 1, verdict: 'lgtm' }).error).toBeTruthy()
  })
})

const reply = { kind: 'issue' as const, number: 5, body: 'ok' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('postReply', () => {
  it('posts when no identical comment exists', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([{ body: 'other', html_url: 'u0' }]))
      .mockResolvedValueOnce(json({ html_url: 'u1' }, 201))
    const r = await postReply('o/r', reply, 't', f as unknown as typeof fetch)
    expect(r.data).toEqual({ url: 'u1', existing: false })
    expect(f.mock.calls[1]![0]).toContain('/issues/5/comments')
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({ body: 'ok' })
  })
  it('double-post guard returns the existing comment without posting', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ body: 'ok\n', html_url: 'u0' }]))
    const r = await postReply('o/r', reply, 't', f as unknown as typeof fetch)
    expect(r.data).toEqual({ url: 'u0', existing: true })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('names the missing permission on 403/404', async () => {
    const issue = await postReply('o/r', reply, 't', (async () => json({}, 403)) as unknown as typeof fetch)
    expect(issue.error).toContain('Issues: Read and write')
    const pr = await postReply('o/r', { ...reply, kind: 'pr' }, 't', (async () => json({}, 404)) as unknown as typeof fetch)
    expect(pr.error).toContain('Pull requests: Read and write')
  })
  it('errors without a token', async () => {
    expect((await postReply('o/r', reply, undefined)).error).toMatch(/GITHUB_TOKEN/)
  })
})

describe('postReply since', () => {
  const since = '2026-11-10T12:00:00.000Z'
  it('(a) an identical ok created before since is ignored: posts a new comment', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([{ body: 'ok', html_url: 'old', created_at: '2026-11-01T00:00:00Z' }]))
      .mockResolvedValueOnce(json({ html_url: 'new' }, 201))
    const r = await postReply('o/r', reply, 't', f as unknown as typeof fetch, { since })
    expect(r.data).toEqual({ url: 'new', existing: false })
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1]![1].method).toBe('POST')
  })
  it('(b) the list URL asks GitHub for since=<encoded ISO>&per_page=100', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ html_url: 'new' }, 201))
    await postReply('o/r', reply, 't', f as unknown as typeof fetch, { since })
    expect(f.mock.calls[0]![0]).toBe(`https://api.github.com/repos/o/r/issues/5/comments?since=${encodeURIComponent(since)}&per_page=100`)
  })
  it('(c) an identical ok created after since is a duplicate: no post', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ body: 'ok', html_url: 'recent', created_at: '2026-11-10T12:05:00Z' }]))
    const r = await postReply('o/r', reply, 't', f as unknown as typeof fetch, { since })
    expect(r.data).toEqual({ url: 'recent', existing: true })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('(d) an old comment returned because it was edited after since still posts', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([{ body: 'ok', html_url: 'old', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-11T00:00:00Z' }]))
      .mockResolvedValueOnce(json({ html_url: 'new' }, 201))
    const r = await postReply('o/r', reply, 't', f as unknown as typeof fetch, { since })
    expect(r.data).toEqual({ url: 'new', existing: false })
  })
  it('(e) without since the URL stays ?per_page=100', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ html_url: 'new' }, 201))
    await postReply('o/r', reply, 't', f as unknown as typeof fetch)
    expect(f.mock.calls[0]![0]).toBe('https://api.github.com/repos/o/r/issues/5/comments?per_page=100')
  })
})

describe('owner gate', () => {
  it('rejects non-owner sessions', () => {
    expect(isOwnerSession({ user: { email: 'x@y.z' } }, 'me@y.z')).toBe(false)
    expect(isOwnerSession(null, 'me@y.z')).toBe(false)
    expect(isOwnerSession({ user: { email: 'ME@y.z' } }, 'me@y.z')).toBe(true)
  })
})
