/**
 * @crouton-generated
 * @collection pages
 * @layer builder
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { builderPageSchema } from './app/composables/useBuilderPages'

describe('builder/pages schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      title: 'sample',
      slug: 'sample',
      status: 'sample',
    }
    expect(builderPageSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      slug: 'sample',
      status: 'sample',
    }
    expect(builderPageSchema.safeParse(invalid).success).toBe(false)
  })
})
