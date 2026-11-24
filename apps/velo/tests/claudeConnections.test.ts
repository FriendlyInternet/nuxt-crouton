import { describe, expect, it, vi } from 'vitest'
import {
  fetchClientNames,
  revokeClaudeConnection,
  toClaudeConnections,
  type ClaudeConnection,
  type Fetcher
} from '../app/utils/claudeConnections'

describe('toClaudeConnections', () => {
  // covers: T1
  it('returns one row per consent, with the client name or clientId, ISO date, newest first', () => {
    const rows = toClaudeConnections([
      { id: 'c1', clientId: 'claude', scopes: ['openid'], createdAt: '2026-11-01T10:00:00.000Z' },
      { id: 'c2', clientId: 'unknown-app', createdAt: new Date('2026-11-20T10:00:00.000Z') },
      { id: 'c3', clientId: 'chatgpt', createdAt: '2026-11-10T10:00:00.000Z' }
    ], { claude: 'Claude', chatgpt: 'ChatGPT' })

    expect(rows).toEqual([
      { id: 'c2', clientId: 'unknown-app', name: 'unknown-app', createdAt: '2026-11-20T10:00:00.000Z' },
      { id: 'c3', clientId: 'chatgpt', name: 'ChatGPT', createdAt: '2026-11-10T10:00:00.000Z' },
      { id: 'c1', clientId: 'claude', name: 'Claude', createdAt: '2026-11-01T10:00:00.000Z' }
    ])
  })

  // covers: T1
  it('returns an empty list for no consents', () => {
    expect(toClaudeConnections([], {})).toEqual([])
  })
})

describe('fetchClientNames', () => {
  // covers: T1
  it('looks each distinct client up once and leaves out failed or nameless lookups', async () => {
    const fetcher = vi.fn<Fetcher>(async (_url, opts) => {
      const id = opts?.query?.client_id
      if (id === 'claude') return { client_name: 'Claude' }
      if (id === 'nameless') return { client_id: 'nameless' }
      throw new Error('404')
    })

    const names = await fetchClientNames(['claude', 'claude', 'nameless', 'gone'], fetcher)

    expect(names).toEqual({ claude: 'Claude' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenCalledWith('/api/auth/oauth2/public-client', { query: { client_id: 'claude' } })

    // the fallback end to end: a failed lookup shows the clientId
    const rows = toClaudeConnections([{ id: 'x', clientId: 'gone', createdAt: '2026-11-01T00:00:00.000Z' }], names)
    expect(rows[0]!.name).toBe('gone')
  })
})

describe('revokeClaudeConnection', () => {
  const rows: ClaudeConnection[] = [
    { id: 'a', clientId: 'claude', name: 'Claude', createdAt: '2026-11-20T00:00:00.000Z' },
    { id: 'b', clientId: 'chatgpt', name: 'ChatGPT', createdAt: '2026-11-10T00:00:00.000Z' }
  ]

  // covers: T2
  it('posts delete-consent with that row id, then drops only that row', async () => {
    const fetcher = vi.fn<Fetcher>(async () => ({ success: true }))

    const next = await revokeClaudeConnection(rows, 'a', fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/auth/oauth2/delete-consent', { method: 'POST', body: { id: 'a' } })
    expect(next).toEqual([rows[1]])
    expect(rows).toHaveLength(2)
  })

  // covers: T2
  it('rethrows when the delete fails and leaves the rows unchanged', async () => {
    const fetcher = vi.fn<Fetcher>(async () => { throw new Error('UNAUTHORIZED') })

    await expect(revokeClaudeConnection(rows, 'b', fetcher)).rejects.toThrow('UNAUTHORIZED')
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
})
