/**
 * @crouton-generated
 * @collection pins
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainPinSchema } from './app/composables/useMainPins'

describe('main/pins schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      title: 'sample',
      url: 'sample',
    }
    expect(mainPinSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      url: 'sample',
    }
    expect(mainPinSchema.safeParse(invalid).success).toBe(false)
  })
})
