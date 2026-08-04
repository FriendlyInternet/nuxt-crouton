/**
 * @crouton-generated
 * @collection items
 * @layer trinket
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { trinketItemSchema } from './app/composables/useTrinketItems'

describe('trinket/items schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {}
    expect(trinketItemSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    // no required fields — a non-object must still be rejected
    expect(trinketItemSchema.safeParse(null).success).toBe(false)
  })
})
