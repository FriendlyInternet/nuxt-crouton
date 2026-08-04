/**
 * Send-out confirmation per location — behaviour contract (#1851).
 *
 * Replaces the two-stage model from epic #1755. Sending out is
 * LOCATION-DEPENDENT: each station hands its own part to the customer, so the
 * kitchen-display tap IS the send-out signal. There is no separate pass.
 *
 * A location can opt out (`requiresHandover: false`): its part never appears on
 * a screen and counts as delivered the moment the order is placed — a bar
 * handing a pils straight over has nothing to confirm.
 *
 * The rule these tests pin: an order is still to deliver when at least one of
 * its REQUIRING locations has no bump. Opt-out locations can never hold an
 * order open.
 */
import { describe, it, expect } from 'vitest'
import { isOrderDelivered, type OrderLocationState } from '../server/utils/location-handover'

const loc = (over: Partial<OrderLocationState>): OrderLocationState => ({
  locationId: 'kitchen', requiresHandover: true, bumped: false, ...over
})

describe('isOrderDelivered', () => {
  it('is not delivered while a requiring location is unbumped', () => {
    expect(isOrderDelivered([loc({ bumped: false })])).toBe(false)
  })

  it('is delivered once every requiring location is bumped', () => {
    expect(isOrderDelivered([
      loc({ locationId: 'kitchen', bumped: true }),
      loc({ locationId: 'grill', bumped: true })
    ])).toBe(true)
  })

  it('is not delivered when only some requiring locations are bumped', () => {
    expect(isOrderDelivered([
      loc({ locationId: 'kitchen', bumped: true }),
      loc({ locationId: 'grill', bumped: false })
    ])).toBe(false)
  })

  it('ignores opt-out locations entirely — they never hold an order open', () => {
    // The bar hands the pils over directly; there is nothing to confirm.
    expect(isOrderDelivered([
      loc({ locationId: 'kitchen', requiresHandover: true, bumped: true }),
      loc({ locationId: 'bar', requiresHandover: false, bumped: false })
    ])).toBe(true)
  })

  it('counts an order touching ONLY opt-out locations as delivered immediately', () => {
    expect(isOrderDelivered([
      loc({ locationId: 'bar', requiresHandover: false, bumped: false })
    ])).toBe(true)
  })

  it('treats a null requiresHandover as REQUIRING confirmation', () => {
    // Pre-migration rows read null. Defaulting those to "no confirmation
    // needed" would mark every historical order delivered on sight — the
    // failure the migration backfill exists to prevent, guarded here too.
    expect(isOrderDelivered([
      loc({ requiresHandover: null as any, bumped: false })
    ])).toBe(false)
  })

  it('counts an order with no locations at all as delivered', () => {
    // Nothing to hand out — an empty order must not sit in the queue forever.
    expect(isOrderDelivered([])).toBe(true)
  })

  it('is unaffected by a bump on an opt-out location', () => {
    // Flipping the switch off mid-event can leave stale bumps behind; they must
    // not change the verdict either way.
    expect(isOrderDelivered([
      loc({ locationId: 'bar', requiresHandover: false, bumped: true }),
      loc({ locationId: 'kitchen', requiresHandover: true, bumped: false })
    ])).toBe(false)
  })
})
