import { describe, it, expect } from 'vitest'
import { formatClosingSummary } from '../../lib/generate-collection.ts'

// #1742 — a soft-deferred migration is printed mid-log and easy to miss; the
// closing summary restates it as numbered step 1. The caller-level rule (both
// `crouton config` and `crouton generate` print it) is pinned by
// tests/integration/closing-summary-cli.test.ts.
const RECIPE = [
  'cd /tmp/app && pnpm install',
  'pnpm db:generate   # drizzle-kit writes server/db/migrations/** (resolves the schema — no Nuxt process)'
]

describe('formatClosingSummary', () => {
  it('(a) deferred → numbered steps, migration first, restart second', () => {
    const lines = formatClosingSummary({ deferred: true, recipe: RECIPE, unresolved: ['@x/a', '@x/b'] })
    expect(lines[0]).toBe('Next steps:')
    expect(lines[1].startsWith('  1. ')).toBe(true)
    expect(lines[1]).toContain('pnpm db:generate')
    expect(lines[1]).toContain('deferred')
    expect(lines[1]).toContain('@x/a')
    expect(lines[1]).toContain('@x/b')
    expect(lines[2]).toBe('  2. Restart your Nuxt dev server')
  })

  it('(b) not deferred → exactly today\'s single line', () => {
    expect(formatClosingSummary({ deferred: false, recipe: [], unresolved: [] }))
      .toEqual(['Next step: Restart your Nuxt dev server'])
  })

  it('(c) null (no migration step ran: noDb / dry run) → same as not deferred', () => {
    expect(formatClosingSummary(null)).toEqual(['Next step: Restart your Nuxt dev server'])
  })

  it('(d) the step line drops the cd prefix and the # comment', () => {
    const [, step] = formatClosingSummary({ deferred: true, recipe: RECIPE, unresolved: ['@x/a'] })
    const command = step.split('   (')[0]
    expect(command).toBe('  1. pnpm install && pnpm db:generate')
    expect(step).not.toContain('cd ')
    expect(step).not.toContain('#')
  })

  it('(e) deferred for a missing db:generate script → step 1 says to add the script', () => {
    const lines = formatClosingSummary({ deferred: true, cause: 'no-db-generate-script', recipe: [], unresolved: [] })
    expect(lines[0]).toBe('Next steps:')
    expect(lines[1]).toMatch(/^ {2}1\. Add "db:generate".*pnpm db:generate/)
    expect(lines[1]).toContain('no db:generate script')
    expect(lines[1]).not.toContain('layers not yet resolved')
    expect(lines[2]).toBe('  2. Restart your Nuxt dev server')
  })
})
