/**
 * @crouton-generated
 * @collection loans
 * @layer lend
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { lendLoanSchema } from './app/composables/useLendLoans'

describe('lend/loans schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      itemName: 'sample',
      borrowerName: 'sample',
      lentDate: '2024-01-01T00:00:00.000Z',
      returned: true,
    }
    expect(lendLoanSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      borrowerName: 'sample',
      lentDate: '2024-01-01T00:00:00.000Z',
      returned: true,
    }
    expect(lendLoanSchema.safeParse(invalid).success).toBe(false)
  })
})
