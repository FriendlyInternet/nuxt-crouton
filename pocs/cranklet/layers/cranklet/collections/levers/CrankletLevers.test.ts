/**
 * @crouton-generated
 * @collection levers
 * @layer cranklet
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { crankletLeverSchema } from './app/composables/useCrankletLevers'

describe('cranklet/levers schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      throw: 1,
    }
    expect(crankletLeverSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      throw: 1,
    }
    expect(crankletLeverSchema.safeParse(invalid).success).toBe(false)
  })
})
