/**
 * KDS feed query plan — D1 bound-parameter contract (#1766).
 *
 * D1 refuses a query carrying more than 100 BOUND PARAMETERS
 * (https://developers.cloudflare.com/d1/platform/limits/). The KDS read
 * endpoint used to fetch EVERY non-cancelled order in the event and then filter
 * out the bumped ones in JavaScript, binding one parameter per order id via
 * `inArray`. So order #101 broke the board — permanently, for the rest of the
 * event.
 *
 * Three things hid it, which is why this file exists rather than a fixture run:
 *   1. local SQLite allows 32 766 parameters, so `hub: { db: 'sqlite' }` can
 *      never reproduce it;
 *   2. the package's tests exercise pure planners with no DB;
 *   3. the client CAUGHT the resulting 500 and kept serving the last board, so
 *      the kitchen saw stale tickets instead of an error (see `kds-board-health`).
 *
 * THE FIX IS NOT CHUNKING. Chunking an `inArray` would keep the query O(event).
 * The board only ever needs OPEN tickets, so the bump exclusion moves into SQL
 * (`LEFT JOIN … WHERE bump IS NULL`) and the order-id list disappears entirely.
 * The parameter count then depends only on the operator's configuration — the
 * event can run all night without moving it.
 *
 * Sibling contract, same root cause, different call site:
 * `packages/crouton-printing/test/enqueue-bound-params.test.ts` (#1710).
 */
import { describe, it, expect } from 'vitest'
// The cap is the platform's number, owned by crouton-core since it bit twice
// (#1707, #1710). Importing it here rather than redeclaring keeps one source of
// truth — a second copy in this package shadowed core's via auto-import.
import { D1_MAX_BOUND_PARAMS } from '@fyit/crouton-core/shared/utils/d1'
import {
  planDisplayJobsQuery,
  MAX_CONFIGURABLE_LOCATIONS
} from '../server/utils/kds-tickets'

describe('planDisplayJobsQuery — the cap cannot be reached by event size', () => {
  it('binds the same number of parameters no matter how long the event runs', () => {
    // The decisive property: the planner takes NO order ids. An event with ten
    // orders and an event with ten thousand produce the identical plan, so the
    // parameter count is structurally independent of how busy the night was.
    const early = planDisplayJobsQuery({ eventId: 'evt-1', locations: ['kitchen'] })
    const late = planDisplayJobsQuery({ eventId: 'evt-1', locations: ['kitchen'] })

    expect(late.params).toEqual(early.params)
    expect(late.params.length).toBe(early.params.length)
  })

  it('stays under the cap for an unfiltered whole-event board', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1' })
    expect(plan.params.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
  })

  it('stays under the cap for a board configured with many stations', () => {
    const locations = Array.from({ length: MAX_CONFIGURABLE_LOCATIONS }, (_, i) => `loc-${i}`)
    const plan = planDisplayJobsQuery({ eventId: 'evt-1', locations })

    expect(plan.params.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
  })

  it('refuses a location list that would blow the cap, rather than failing at the database', () => {
    // An operator can only get here by misconfiguring a block, but the failure
    // must be loud and local — not a 500 from D1 that the client swallows.
    const tooMany = Array.from({ length: MAX_CONFIGURABLE_LOCATIONS + 1 }, (_, i) => `loc-${i}`)

    expect(() => planDisplayJobsQuery({ eventId: 'evt-1', locations: tooMany })).toThrow()
  })

  it('keeps headroom below the hard cap for the columns drizzle binds implicitly', () => {
    // The #1710 lesson: drizzle also binds `$default` columns the row object
    // does not contain, so a plan sized exactly to 100 is already over.
    const locations = Array.from({ length: MAX_CONFIGURABLE_LOCATIONS }, (_, i) => `loc-${i}`)
    const plan = planDisplayJobsQuery({ eventId: 'evt-1', locations })

    expect(plan.params.length).toBeLessThan(D1_MAX_BOUND_PARAMS)
  })
})

describe('planDisplayJobsQuery — the board reads open tickets, not event history', () => {
  it('excludes already-bumped tickets in SQL, not after the fact', () => {
    // This is what makes the query O(open tickets) instead of O(event), and it
    // is the property that removes the order-id list.
    const plan = planDisplayJobsQuery({ eventId: 'evt-1' })
    expect(plan.excludesBumpedInSql).toBe(true)
  })

  it('excludes cancelled orders', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1' })
    expect(plan.excludesCancelled).toBe(true)
  })

  it('always applies a row limit, so one runaway event cannot exhaust the worker', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1' })
    expect(plan.limit).toBeGreaterThan(0)
  })

  it('honours an explicit limit', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1', limit: 50 })
    expect(plan.limit).toBe(50)
  })

  it('scopes to the event it was asked for', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-42' })
    expect(plan.params).toContain('evt-42')
  })
})

describe('planDisplayJobsQuery — location scoping', () => {
  it('treats no configured locations as the whole event', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1' })
    expect(plan.locations).toEqual([])
  })

  it('binds one parameter per configured location', () => {
    const one = planDisplayJobsQuery({ eventId: 'evt-1', locations: ['kitchen'] })
    const two = planDisplayJobsQuery({ eventId: 'evt-1', locations: ['kitchen', 'bar'] })

    expect(two.params.length).toBe(one.params.length + 1)
  })

  it('ignores blank entries rather than binding an empty string that matches nothing', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1', locations: ['kitchen', '', '  '] })
    expect(plan.locations).toEqual(['kitchen'])
  })

  it('requires a real location, so an unroutable item reaches no board', () => {
    // Owner's call: a product without a "Prep Location" is malformed data, not
    // a station's problem. The query never routes one to a screen — the count
    // the shaper returns is how that stops being silent.
    const plan = planDisplayJobsQuery({ eventId: 'evt-1' })
    expect(plan.requiresLocation).toBe(true)
  })

  it('requires a real location on a station-filtered board too', () => {
    const plan = planDisplayJobsQuery({ eventId: 'evt-1', locations: ['kitchen'] })
    expect(plan.requiresLocation).toBe(true)
  })
})
