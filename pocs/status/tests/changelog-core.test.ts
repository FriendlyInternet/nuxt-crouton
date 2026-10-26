import { describe, it, expect } from 'vitest'
import { stripTitle, deriveArea, buildChangelog } from '../server/utils/changelog-core'

describe('stripTitle', () => {
  it('removes conventional-commit prefixes', () => {
    expect(stripTitle('feat(velo): add rides')).toBe('Add rides')
    expect(stripTitle('fix!: boom')).toBe('Boom')
    expect(stripTitle('chore(ci): bump')).toBe('Bump')
  })
  it('leaves plain titles alone', () => expect(stripTitle('Add rides')).toBe('Add rides'))
})

describe('deriveArea', () => {
  it('prefers labels, then branch, then title', () => {
    expect(deriveArea({ title: 'x', labels: [{ name: 'app:kassa' }] })).toBe('Kassa')
    expect(deriveArea({ title: 'x', head: { ref: 'work-1-velo-thing' } })).toBe('Velo')
    expect(deriveArea({ title: 'feat(crouton-core): x' })).toBe('Shared packages')
    expect(deriveArea({ title: 'ci: tweak workflow' })).toBe('Pipeline')
    expect(deriveArea({ title: 'misc' })).toBe('Other')
  })
})

describe('buildChangelog', () => {
  const now = new Date('2026-10-26T00:00:00Z')
  const pr = (n: number, merged_at: string | null) => ({ number: n, title: `fix: t${n}`, html_url: `u${n}`, merged_at })
  it('keeps merged PRs in window, newest first', () => {
    const rows = buildChangelog([pr(1, '2026-10-01T10:00:00Z'), pr(2, '2026-10-20T10:00:00Z'), pr(3, null), pr(4, '2026-08-01T00:00:00Z')], now)
    expect(rows.map(r => r.number)).toEqual([2, 1])
    expect(rows[0]).toMatchObject({ date: '2026-10-20', title: 'T2', url: 'u2' })
  })
})
