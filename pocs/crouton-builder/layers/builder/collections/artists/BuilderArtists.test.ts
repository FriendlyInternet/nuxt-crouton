/**
 * @crouton-generated
 * @collection artists
 * @layer builder
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { builderArtistSchema } from './app/composables/useBuilderArtists'

describe('builder/artists schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      genre: 'sample',
    }
    expect(builderArtistSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      genre: 'sample',
    }
    expect(builderArtistSchema.safeParse(invalid).success).toBe(false)
  })
})
