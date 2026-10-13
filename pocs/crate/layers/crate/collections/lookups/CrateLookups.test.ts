/**
 * @crouton-generated
 * @collection lookups
 * @layer crate
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { crateLookupSchema } from './app/composables/useCrateLookups'

describe('crate/lookups schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      trackId: 'sample',
      fetchedAt: '2024-01-01T00:00:00.000Z',
    }
    expect(crateLookupSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      fetchedAt: '2024-01-01T00:00:00.000Z',
    }
    expect(crateLookupSchema.safeParse(invalid).success).toBe(false)
  })
})
