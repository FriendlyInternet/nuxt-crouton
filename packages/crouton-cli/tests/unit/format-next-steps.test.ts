import { describe, it, expect } from 'vitest'
import { formatNextSteps } from '../../lib/generate-collection'

describe('formatNextSteps (#1742)', () => {
  it('lists the deferred migration as numbered step 1', () => {
    const out = formatNextSteps(['pnpm install', 'pnpm db:generate'])
    expect(out).toContain('1. Generate the database migration (deferred')
    expect(out).toContain('pnpm db:generate')
    expect(out).toContain('2. Restart your Nuxt dev server')
  })
  it('omits the migration step when nothing was deferred', () => {
    const out = formatNextSteps(undefined)
    expect(out).not.toContain('deferred')
    expect(out).toContain('1. Restart your Nuxt dev server')
  })
})
