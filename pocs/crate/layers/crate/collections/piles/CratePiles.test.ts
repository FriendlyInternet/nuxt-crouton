/**
 * @crouton-generated
 * @collection piles
 * @layer crate
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { cratePileSchema } from './app/composables/useCratePiles'

describe('crate/piles schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
    }
    expect(cratePileSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {}
    expect(cratePileSchema.safeParse(invalid).success).toBe(false)
  })
})
