/**
 * @crouton-generated
 * @collection awards
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainAwardSchema } from './app/composables/useMainAwards'

describe('main/awards schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      points: 1,
    }
    expect(mainAwardSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      points: 1,
    }
    expect(mainAwardSchema.safeParse(invalid).success).toBe(false)
  })
})
