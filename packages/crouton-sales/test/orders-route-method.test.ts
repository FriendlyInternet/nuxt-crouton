/**
 * The till's order route answers 405 to anything but POST (#4481).
 *
 * A `.post.ts` route 404s on a GET, so the deployed smoke (a GET) could not
 * tell "route is mounted" from "route missing". The route is now `index.ts`
 * with its own method check, like crouton-email's Resend webhook. This calls
 * the real handler: a GET must stop at 405 before any token or database work.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

const requireScopedEvent = vi.fn(async () => {
  throw Object.assign(new Error('no token'), { statusCode: 401 })
})
vi.mock('../server/utils/require-scoped-event', () => ({ requireScopedEvent }))

let handler: (event: any) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusMessage), o))
  handler = (await import('../server/api/crouton-sales/events/[eventId]/orders/index')).default as any
})

describe('events/[eventId]/orders route method', () => {
  it.each(['GET', 'PUT', 'DELETE'])('%s → 405, without touching the token check', async (method) => {
    requireScopedEvent.mockClear()
    await expect(handler({ method })).rejects.toMatchObject({ statusCode: 405 })
    expect(requireScopedEvent).not.toHaveBeenCalled()
  })

  it('POST goes on to the token check', async () => {
    requireScopedEvent.mockClear()
    await expect(handler({ method: 'POST' })).rejects.toMatchObject({ statusCode: 401 })
    expect(requireScopedEvent).toHaveBeenCalledTimes(1)
  })
})
