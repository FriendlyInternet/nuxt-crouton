/**
 * @crouton-generated
 * @collection widgets
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainWidgetSchema } from './app/composables/useMainWidgets'

describe('main/widgets schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      quantity: 1,
      active: true,
    }
    expect(mainWidgetSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      quantity: 1,
      active: true,
    }
    expect(mainWidgetSchema.safeParse(invalid).success).toBe(false)
  })
})
