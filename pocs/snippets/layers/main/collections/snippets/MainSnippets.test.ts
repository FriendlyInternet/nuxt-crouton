/**
 * @crouton-generated
 * @collection snippets
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainSnippetSchema } from './app/composables/useMainSnippets'

describe('main/snippets schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      title: 'sample',
      code: 'sample',
    }
    expect(mainSnippetSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      code: 'sample',
    }
    expect(mainSnippetSchema.safeParse(invalid).success).toBe(false)
  })
})
