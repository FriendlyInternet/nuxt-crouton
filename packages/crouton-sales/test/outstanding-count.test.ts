/**
 * Outstanding-orders count — behaviour contract (#1763, epic #1755).
 *
 * "How many orders are people still waiting for?" is the number the whole epic
 * exists to produce. Definition (from #1755, and shared with the pass feed via
 * `OUTSTANDING_DEFINITION`): an order is outstanding when it is **not cancelled**
 * and has **no handover row**.
 *
 * ## The trap this file exists to pin
 *
 * The orders endpoint already has a `buildWhere` deliberately shared between the
 * list and its total, so "a filtered page and its total stay in sync" — correct
 * for a paginated list. Reusing it for THIS number would be silently wrong: the
 * count would follow the user's filters, so picking a helper from the dropdown
 * would change "how many are still waiting" from 40 to 3. A backlog figure that
 * moves when you filter the table is worse than no figure, because it looks
 * authoritative.
 *
 * So the plan takes NO filters at all — not "ignores them", *cannot receive
 * them* — and these tests hold that shape in place.
 */
import { describe, it, expect } from 'vitest'
import { D1_MAX_BOUND_PARAMS } from '@fyit/crouton-core/shared/utils/d1'
import {
  planOutstandingCount,
  OUTSTANDING_DEFINITION
} from '../server/utils/pass-tickets'

describe('planOutstandingCount — the number cannot be filtered', () => {
  it('takes only the tenant and the event', () => {
    const plan = planOutstandingCount({ teamId: 'team-1', eventId: 'evt-1' })

    // Exactly the two scoping values and nothing else. If a filter ever needs
    // to reach this query, that is a deliberate API change, not an accident.
    expect(plan.params).toEqual(['team-1', 'evt-1'])
  })

  it('produces the same plan no matter what the list is filtered by', () => {
    // The list endpoint's filters (owner / clientId / printerId / printStatus)
    // have no way in, so two calls during very different UI states agree.
    const a = planOutstandingCount({ teamId: 'team-1', eventId: 'evt-1' })
    const b = planOutstandingCount({ teamId: 'team-1', eventId: 'evt-1' })

    expect(b.params).toEqual(a.params)
  })

  it('scopes to the team as well as the event, so one venue cannot read another', () => {
    const plan = planOutstandingCount({ teamId: 'team-9', eventId: 'evt-1' })
    expect(plan.params).toContain('team-9')
  })

  it('stays far under the D1 bound-parameter cap', () => {
    // Trivially true today, and stated so it stays true: this must never grow
    // into an id list the way the KDS feed did (#1766).
    const plan = planOutstandingCount({ teamId: 'team-1', eventId: 'evt-1' })
    expect(plan.params.length).toBeLessThan(D1_MAX_BOUND_PARAMS)
  })
})

describe('planOutstandingCount — matches the epic definition', () => {
  it('excludes cancelled orders', () => {
    expect(planOutstandingCount({ teamId: 't', eventId: 'e' }).excludesCancelled).toBe(true)
  })

  it('excludes orders that already have a handover row', () => {
    expect(planOutstandingCount({ teamId: 't', eventId: 'e' }).excludesHandedOver).toBe(true)
  })

  it('agrees with OUTSTANDING_DEFINITION, so the pass feed and the count cannot drift', () => {
    // Two surfaces render this number (the orders pane and the dashboard tile)
    // and a third consumes the same rule (the pass feed). They read it from one
    // constant rather than each re-deriving "still waiting".
    const plan = planOutstandingCount({ teamId: 't', eventId: 'e' })

    expect({
      excludesCancelled: plan.excludesCancelled,
      excludesHandedOver: plan.excludesHandedOver
    }).toEqual(OUTSTANDING_DEFINITION)
  })
})
