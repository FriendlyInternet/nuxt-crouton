import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateConfig } from '../../../lib/utils/validate-config.ts'

// #1741 — a freshly scaffolded app has no schema and no collections yet. That is the
// documented next step, not a validation failure, so `crouton config` on a cold scaffold
// used to greet a new user with a red "Validation failed ❌" for doing nothing wrong.
//
// These tests exist because of #1976, not #1741. The fix shipped, its issue closed, and the
// code never reached `main`: the epic branch merged its children and never opened a PR to
// trunk. The re-land's acceptance check was `git cat-file -e <path>` — but the file already
// existed, so that assertion could not fail whatever happened, and the miss survived a second
// time. A behavioural test is the assertion that can actually fail, which is the whole point.

describe('validateConfig — empty scaffold', () => {
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { log.mockRestore() })

  const output = () => log.mock.calls.map((c) => String(c[0] ?? '')).join('\n')

  it('accepts a cold scaffold instead of failing validation', async () => {
    const result = await validateConfig({ collections: [] })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('says what to do next, and does not say anything failed', async () => {
    await validateConfig({ collections: [] })
    expect(output()).toContain('Scaffolded')
    expect(output()).toContain('schemas/')
    expect(output()).not.toMatch(/failed/i)
  })

  it('treats absent `targets` and empty `targets` the same', async () => {
    await expect(validateConfig({ collections: [] })).resolves.toMatchObject({ valid: true })
    await expect(validateConfig({ collections: [], targets: [] })).resolves.toMatchObject({ valid: true })
  })

  // The discriminating cases: the neutral path must be narrow, or it swallows real problems.
  it('does NOT take the scaffold path once a schemaPath is configured', async () => {
    await validateConfig({ collections: [], schemaPath: 'schemas/thing.json' })
    expect(output()).not.toContain('Scaffolded')
  })

  it('does NOT take the scaffold path once a collection is configured', async () => {
    await validateConfig({ collections: [{ name: 'things', schemaPath: 'schemas/things.json' }] })
    expect(output()).not.toContain('Scaffolded')
  })

  // A target is an object carrying its own `collections` list, not a bare name.
  it('does NOT take the scaffold path once a target is configured', async () => {
    await validateConfig({ collections: [], targets: [{ name: 'app', collections: [] }] })
    expect(output()).not.toContain('Scaffolded')
  })

  it('a null config is still a hard failure — the scaffold path must not swallow it', async () => {
    const result = await validateConfig(null)
    expect(result.valid).toBe(false)
  })
})
