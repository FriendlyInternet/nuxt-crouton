/**
 * Pass-screen feed query plan — D1 bound-parameter contract (#1761).
 *
 * Same platform limit that broke the KDS board (#1766): D1 refuses a query
 * carrying more than 100 bound parameters, and local SQLite allows 32 766, so
 * the failure is invisible in development and permanent in production.
 *
 * The pass feed is if anything MORE exposed than the KDS was, because its
 * readiness rule ("every location of this order has gone ready") is tempting to
 * implement as: fetch the event's orders → collect their ids → query bumps with
 * `inArray(orderId, ids)`. That is precisely the shape that broke #1766, and it
 * would break here for the same reason.
 *
 * So the contract is inherited: the plan takes NO order ids, the handover
 * exclusion lives in SQL, and the parameter count is fixed by configuration
 * rather than by how long the event has been running.
 */
import { describe, it, expect } from 'vitest'
import { D1_MAX_BOUND_PARAMS } from '@fyit/crouton-core/shared/utils/d1'
import { planPassJobsQuery } from '../server/utils/pass-tickets'

describe('planPassJobsQuery — event size cannot reach the cap', () => {
  it('takes no order ids, so a long night cannot change the parameter count', () => {
    const early = planPassJobsQuery({ eventId: 'evt-1' })
    const late = planPassJobsQuery({ eventId: 'evt-1' })

    expect(late.params).toEqual(early.params)
  })

  it('stays under the cap', () => {
    const plan = planPassJobsQuery({ eventId: 'evt-1' })
    expect(plan.params.length).toBeLessThan(D1_MAX_BOUND_PARAMS)
  })

  it('scopes to the event it was asked for', () => {
    const plan = planPassJobsQuery({ eventId: 'evt-42' })
    expect(plan.params).toContain('evt-42')
  })
})

describe('planPassJobsQuery — reads open orders, not event history', () => {
  it('excludes already-handed-over orders in SQL', () => {
    // Without this the feed would re-offer every order ever completed, and the
    // runner would hand out the same order twice.
    const plan = planPassJobsQuery({ eventId: 'evt-1' })
    expect(plan.excludesHandedOverInSql).toBe(true)
  })

  it('excludes cancelled orders', () => {
    const plan = planPassJobsQuery({ eventId: 'evt-1' })
    expect(plan.excludesCancelled).toBe(true)
  })

  it('always applies a row limit', () => {
    const plan = planPassJobsQuery({ eventId: 'evt-1' })
    expect(plan.limit).toBeGreaterThan(0)
  })

  it('honours an explicit limit', () => {
    expect(planPassJobsQuery({ eventId: 'evt-1', limit: 50 }).limit).toBe(50)
  })
})

describe('countOutstandingOrders — the number WS4 renders', () => {
  it('is defined as: not cancelled, and no handover row', async () => {
    // The epic (#1755) holds this definition; WS4 reads it from here rather
    // than re-deriving it, so the admin page and the dashboard cannot disagree
    // about what "still waiting" means.
    const { OUTSTANDING_DEFINITION } = await import('../server/utils/pass-tickets')

    expect(OUTSTANDING_DEFINITION).toEqual({
      excludesCancelled: true,
      excludesHandedOver: true
    })
  })
})
