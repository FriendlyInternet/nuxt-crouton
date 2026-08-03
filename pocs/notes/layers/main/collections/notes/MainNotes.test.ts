/**
 * @crouton-generated
 * @collection notes
 * @layer main
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { mainNoteSchema } from './app/composables/useMainNotes'

describe('main/notes schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      title: 'sample',
    }
    expect(mainNoteSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {}
    expect(mainNoteSchema.safeParse(invalid).success).toBe(false)
  })
})
