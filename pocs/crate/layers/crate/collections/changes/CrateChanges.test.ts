/**
 * @crouton-generated
 * @collection changes
 * @layer crate
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { crateChangeSchema } from './app/composables/useCrateChanges'

describe('crate/changes schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      groupId: 'sample',
      trackId: 'sample',
    }
    expect(crateChangeSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      trackId: 'sample',
    }
    expect(crateChangeSchema.safeParse(invalid).success).toBe(false)
  })
})
