/**
 * @crouton-generated
 * @collection products
 * @layer sales
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { salesProductSchema } from './app/composables/useSalesProducts'

describe('sales/products schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      eventId: 'sample',
      categoryId: 'sample',
      locationId: 'sample',
      title: 'sample',
      price: 1,
    }
    expect(salesProductSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      categoryId: 'sample',
      locationId: 'sample',
      title: 'sample',
      price: 1,
    }
    expect(salesProductSchema.safeParse(invalid).success).toBe(false)
  })
})
