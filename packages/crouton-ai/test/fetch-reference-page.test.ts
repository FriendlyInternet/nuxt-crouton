import { describe, expect, it } from 'vitest'
import { fetchReferencePage, isBlockedHost } from '../server/utils/fetch-reference-page'

const BLOCKED = [
  '127.0.0.1',
  '10.1.2.3',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254',
  '[::1]',
  '[fd00::1]',
  '[fe80::1]',
  '[::ffff:127.0.0.1]',
  '[::ffff:7f00:1]',
  'localhost',
  'localhost.',
  'printer.local'
]

const ALLOWED = ['172.15.0.1', '172.32.0.1', '8.8.8.8', 'example.com']

function fakeFetch(respond: () => Response) {
  const calls: Array<{ url: string, init?: RequestInit }> = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return respond()
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('isBlockedHost', () => {
  it.each(BLOCKED)('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true)
  })

  it.each(ALLOWED)('allows %s', (host) => {
    expect(isBlockedHost(host)).toBe(false)
  })
})

describe('fetchReferencePage', () => {
  it.each([
    ...BLOCKED.map(h => `http://${h}/`),
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/'
  ])('returns null for %s without fetching', async (url) => {
    const { impl, calls } = fakeFetch(() => new Response('<html></html>'))
    expect(await fetchReferencePage(url, { fetchImpl: impl })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('does not follow a redirect', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/' } }))
    expect(await fetchReferencePage('https://example.com/', { fetchImpl: impl })).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init?.redirect).toBe('manual')
  })

  it('stops reading at maxBytes and cancels the stream', async () => {
    let cancelled = false
    const chunk = new TextEncoder().encode('a'.repeat(64 * 1024))
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 2 * 1024 * 1024) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
        sent += chunk.length
      },
      cancel() {
        cancelled = true
      }
    })
    const { impl } = fakeFetch(() => new Response(body, { status: 200 }))
    const text = await fetchReferencePage('https://example.com/', { fetchImpl: impl, maxBytes: 1000 })
    expect(text).not.toBeNull()
    expect(new TextEncoder().encode(text!).length).toBeLessThanOrEqual(1000)
    expect(cancelled).toBe(true)
  })

  it('returns the HTML of a normal 200 page', async () => {
    const html = '<html><head><title>Hi</title></head><body><p>Hello world</p></body></html>'
    const { impl } = fakeFetch(() => new Response(html, { status: 200 }))
    expect(await fetchReferencePage('https://example.com/', { fetchImpl: impl })).toBe(html)
  })
})
