/**
 * @crouton-generated
 * @collection handovers
 * @layer sales
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { salesHandoverSchema } from './app/composables/useSalesHandovers'

describe('sales/handovers schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      eventId: 'sample',
      orderId: 'sample',
    }
    expect(salesHandoverSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      orderId: 'sample',
    }
    expect(salesHandoverSchema.safeParse(invalid).success).toBe(false)
  })
})
