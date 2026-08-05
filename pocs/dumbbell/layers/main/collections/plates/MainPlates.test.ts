/**
 * @crouton-generated
 * @collection plates
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainPlateSchema } from './app/composables/useMainPlates'

describe('main/plates schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      weight: 1,
    }
    expect(mainPlateSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      weight: 1,
    }
    expect(mainPlateSchema.safeParse(invalid).success).toBe(false)
  })
})
