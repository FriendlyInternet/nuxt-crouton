/**
 * @crouton-generated
 * @collection chores
 * @layer chores
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { choresChoreSchema } from './app/composables/useChoresChores'

describe('chores/chores schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      name: 'sample',
      cadence: 'sample',
      assigneeId: 'sample',
    }
    expect(choresChoreSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      cadence: 'sample',
      assigneeId: 'sample',
    }
    expect(choresChoreSchema.safeParse(invalid).success).toBe(false)
  })
})
