import { describe, expect, it, vi } from 'vitest'
import { deliveryOpenLink, sendDelivery, validateDelivery } from '../app/utils/delivery-core'
import { loginHrefFor } from '../app/utils/walk'
import type { InboxCard } from '../app/utils/inbox-core'

// Own fixture card — a landed epic waiting to be tried. fetch is mocked: never hits the server.
const deliveryCard = (payload: Record<string, unknown> | null = { app: 'velo', to: '/bookings', steps: ['Open bookings', 'Add one'] }): InboxCard => ({
  id: 'card-d1',
  kind: 'delivery',
  state: 'waiting',
  askedAt: '2026-11-15T10:00:00Z',
  title: 'Bookings epic',
  ask: 'Try it, then reply ok or not ok.',
  link: 'https://github.com/o/r/issues/77',
  payload,
  sourceType: 'issue',
  sourceNumber: 77
})

function fakeFetch(status = 200, body: unknown = { data: { url: 'u', existing: false }, error: null }) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
  return f
}

describe('sendDelivery', () => {
  it('Works → the card answer endpoint is called once with delivery + works', async () => {
    const f = fakeFetch()
    const r = await sendDelivery({ cardId: 'card-d1', verdict: 'works', fetchImpl: f as unknown as typeof fetch })
    expect(r).toEqual({ status: 200, error: null })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('/api/cards/card-d1/answer')
    expect(init!.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({ kind: 'delivery', verdict: 'works', note: '' })
  })

  it('Not ok with a note → sent as not-ok with the trimmed note', async () => {
    const f = fakeFetch()
    await sendDelivery({ cardId: 'card-d1', verdict: 'not-ok', note: '  login loops ', fetchImpl: f as unknown as typeof fetch })
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ kind: 'delivery', verdict: 'not-ok', note: 'login loops' })
  })

  it('Not ok without a note → refused before any call', async () => {
    const f = fakeFetch()
    const r = await sendDelivery({ cardId: 'card-d1', verdict: 'not-ok', note: '   ', fetchImpl: f as unknown as typeof fetch })
    expect(r.error).toBe('Add a short note first.')
    expect(f).not.toHaveBeenCalled()
  })

  it('server refuses → its statusMessage comes back, status kept', async () => {
    const f = fakeFetch(403, { statusMessage: 'not the owner' })
    const r = await sendDelivery({ cardId: 'card-d1', verdict: 'works', fetchImpl: f as unknown as typeof fetch })
    expect(r).toEqual({ status: 403, error: 'not the owner' })
  })

  it('validateDelivery refuses an unknown verdict', () => {
    expect(validateDelivery('ok', '')).toBe('Pick Works or Not ok.')
    expect(validateDelivery('works', '')).toBeNull()
  })
})

describe('deliveryOpenLink', () => {
  it('equals loginHrefFor for the payload (app, to, steps)', () => {
    const c = deliveryCard()
    expect(deliveryOpenLink(c)).toBe(loginHrefFor({ app: 'velo', number: 77, title: 'Bookings epic', to: '/bookings', steps: ['Open bookings', 'Add one'] }))
    expect(deliveryOpenLink(c)).toMatch(/^\/api\/status\/login\/velo\?to=%2Fbookings&walk=/)
  })

  it('no payload.app → no open link', () => {
    expect(deliveryOpenLink(deliveryCard({ to: '/x', steps: [] }))).toBeNull()
    expect(deliveryOpenLink(deliveryCard(null))).toBeNull()
  })
})
