/**
 * @crouton-generated
 * @collection tracks
 * @layer crate
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { crateTrackSchema } from './app/composables/useCrateTracks'

describe('crate/tracks schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      rekordboxId: 'sample',
      name: 'sample',
      location: 'sample',
    }
    expect(crateTrackSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      name: 'sample',
      location: 'sample',
    }
    expect(crateTrackSchema.safeParse(invalid).success).toBe(false)
  })
})
