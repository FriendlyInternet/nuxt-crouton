/**
 * @crouton-generated
 * @collection parts
 * @layer widget
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { widgetPartSchema } from './app/composables/useWidgetParts'

describe('widget/parts schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      title: 'sample',
      qty: 1,
    }
    expect(widgetPartSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      qty: 1,
    }
    expect(widgetPartSchema.safeParse(invalid).success).toBe(false)
  })
})
