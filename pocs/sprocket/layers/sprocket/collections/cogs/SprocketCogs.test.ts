/**
 * @crouton-generated
 * @collection cogs
 * @layer sprocket
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { sprocketCogSchema } from './app/composables/useSprocketCogs'

describe('sprocket/cogs schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      teeth: 1,
    }
    expect(sprocketCogSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      teeth: 1,
    }
    expect(sprocketCogSchema.safeParse(invalid).success).toBe(false)
  })
})
