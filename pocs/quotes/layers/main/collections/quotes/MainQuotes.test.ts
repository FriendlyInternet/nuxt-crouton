/**
 * @crouton-generated
 * @collection quotes
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainQuoteSchema } from './app/composables/useMainQuotes'

describe('main/quotes schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      text: 'sample',
    }
    expect(mainQuoteSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {}
    expect(mainQuoteSchema.safeParse(invalid).success).toBe(false)
  })
})
