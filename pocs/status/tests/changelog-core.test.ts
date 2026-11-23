import { describe, it, expect } from 'vitest'
import { stripTitle, deriveArea, deriveKind, buildChangelog, issueNumber, issueSearchPath, issueLabelMap } from '../server/utils/changelog-core'
import { dayHeader, groupByDay } from '../app/utils/dashboard'

const L = (...n: string[]) => n.map(name => ({ name }))

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
    expect(deriveArea({ title: 'x', labels: [{ name: 'app:kassa' }] })).toBe('kassa')
    expect(deriveArea({ title: 'x', head: { ref: 'work-1-velo-thing' } })).toBe('Velo')
    expect(deriveArea({ title: 'feat(crouton-core): x' })).toBe('Shared packages')
    expect(deriveArea({ title: 'ci: tweak workflow' })).toBe('Pipeline')
    expect(deriveArea({ title: 'misc' })).toBe('Other')
  })

  // How to test 1-4, 6
  it('tags from app/poc/pkg labels, names as written', () => {
    expect(deriveArea({ title: 'x', labels: L('app:velo', 'pipeline:v1', 'type:fix') })).toBe('velo')
    expect(deriveArea({ title: 'x', labels: L('poc:status', 'type:feat') })).toBe('status')
    expect(deriveArea({ title: 'x', labels: L('pkg:crouton-core') })).toBe('crouton-core · all apps')
    expect(deriveArea({ title: 'x', labels: L('workflow') })).toBe('Pipeline')
    expect(deriveArea({ title: 'x', labels: L('pkg:crouton-bookings', 'app:velo') })).toBe('velo')
    expect(deriveArea({ title: 'x', labels: L('app:velo', 'pkg:crouton-bookings') })).toBe('velo')
  })

  it('bookkeeping labels never decide a tag', () => {
    expect(deriveArea({ title: 'Velo: fix the map', head: { ref: 'work-4310' }, labels: L('pipeline:v1') })).toBe('Velo')
    expect(deriveArea({ title: 'Make buttons round', labels: L('ci-fix-attempts:1') })).not.toBe('Pipeline')
    expect(deriveArea({ title: 'x', labels: L('build:approved', 'status:blocked', 'plan:go') })).toBe('Other')
  })

  it('issue labels come before the PR labels', () => {
    expect(deriveArea({ title: 'x', labels: L('app:kassa') }, ['app:velo'])).toBe('velo')
  })
})

describe('deriveKind', () => {
  it('reads type:* labels first, then the title prefix', () => {
    expect(deriveKind('x', ['app:velo', 'pipeline:v1', 'type:fix'])).toBe('fix')
    expect(deriveKind('x', ['poc:status', 'type:feat'])).toBe('new')
    expect(deriveKind('x', ['type:docs'])).toBe('chore')
    expect(deriveKind('chore(loop-station): record context-budget inventory', [])).toBe('chore')
    expect(deriveKind('feat(velo): rides')).toBe('new')
    expect(deriveKind('fix!: boom')).toBe('fix')
    expect(deriveKind('ci: bump')).toBe('chore')
    expect(deriveKind('build: bump')).toBe('chore')
    expect(deriveKind('refactor: tidy')).toBe('change')
    expect(deriveKind('Plain title')).toBe('change')
  })
})

describe('issueNumber', () => {
  it('branch work-<N>, else Closes #N in the body, else none', () => {
    expect(issueNumber({ head: { ref: 'work-12' } })).toBe(12)
    expect(issueNumber({ head: { ref: 'feat/x' }, body: 'Some text\nCloses #34\nFixes #35' })).toBe(34)
    expect(issueNumber({ head: { ref: 'feat/x' }, body: 'nothing linked' })).toBeNull()
    expect(issueNumber({})).toBeNull()
  })
})

describe('issueSearchPath', () => {
  it('searches issues closed since the oldest merge, by page', () => {
    const pulls = [{ merged_at: '2026-11-19T10:00:00Z' }, { merged_at: null }, { merged_at: '2026-11-17T16:15:43Z' }]
    const p = issueSearchPath(pulls)!
    expect(decodeURIComponent(p)).toContain('repo:FriendlyInternet/nuxt-crouton is:issue is:closed closed:>=2026-11-17')
    expect(p).toMatch(/&sort=updated&order=desc&per_page=100&page=1$/)
    expect(issueSearchPath(pulls, 2)).toMatch(/&page=2$/)
    expect(issueSearchPath([{ merged_at: null }])).toBeNull()
  })
  it('maps issue numbers to label names (object or string labels)', () => {
    const m = issueLabelMap([{ number: 1, labels: [{ name: 'app:velo' }, 'type:fix'] }, { number: 2 }])
    expect(m.get(1)).toEqual(['app:velo', 'type:fix'])
    expect(m.get(2)).toEqual([])
  })
})

describe('buildChangelog', () => {
  const now = new Date('2026-10-26T00:00:00Z')
  const pr = (n: number, merged_at: string | null) => ({ number: n, title: `fix: t${n}`, html_url: `u${n}`, merged_at })
  it('keeps merged PRs in window, newest first', () => {
    const rows = buildChangelog([pr(1, '2026-10-01T10:00:00Z'), pr(2, '2026-10-20T10:00:00Z'), pr(3, null), pr(4, '2026-08-01T00:00:00Z')], now)
    expect(rows.map(r => r.number)).toEqual([2, 1])
    expect(rows[0]).toMatchObject({ date: '2026-10-20', mergedAt: '2026-10-20T10:00:00Z', title: 'T2', url: 'u2', kind: 'fix' })
  })

  // How to test 7: the real bug (#4310)
  const real = {
    number: 4310,
    title: 'Velo booking fix',
    html_url: 'u',
    merged_at: '2026-10-25T10:00:00Z',
    head: { ref: 'work-4300' },
    labels: L('ci-fix-attempts:1', 'build:approved')
  }
  it('tags a PR from its linked issue, not its bookkeeping labels', () => {
    const [row] = buildChangelog([real], now, 30, new Map([[4300, ['app:velo', 'type:fix']]]))
    expect(row).toMatchObject({ area: 'velo', kind: 'fix' })
  })
  it('falls back to the PR when the issue is not found or the search failed', () => {
    const lone = { ...real, title: 'Make buttons round', labels: L('ci-fix-attempts:1') }
    expect(buildChangelog([lone], now, 30, new Map())[0]!.area).not.toBe('Pipeline')
    expect(() => buildChangelog([lone, real], now, 30, null)).not.toThrow()
    const rows = buildChangelog([lone, real], now, 30, null)
    expect(rows.map(r => r.area)).not.toContain('Pipeline')
  })
})

describe('dayHeader', () => {
  it('uses the Brussels day: a 23:30 UTC merge on 19 Nov is 20 Nov', () => {
    expect(dayHeader('2026-11-19T23:30:00Z', new Date('2026-11-25T12:00:00Z'))).toBe('Fri 20 Nov')
  })
  it('Today and Yesterday', () => {
    const now = new Date('2026-11-20T12:00:00Z')
    expect(dayHeader('2026-11-19T23:30:00Z', now)).toBe('Today')
    expect(dayHeader('2026-11-19T10:00:00Z', now)).toBe('Yesterday')
    expect(dayHeader('2026-11-18T10:00:00Z', now)).toBe('Wed 18 Nov')
  })
  it('groups newest-first rows under their headers in order', () => {
    const now = new Date('2026-11-20T12:00:00Z')
    const row = (n: number, mergedAt: string) => ({ date: mergedAt.slice(0, 10), mergedAt, number: n, title: 't', area: 'a', kind: 'change' as const, url: 'u' })
    const g = groupByDay([row(1, '2026-11-20T09:00:00Z'), row(2, '2026-11-19T23:30:00Z'), row(3, '2026-11-19T10:00:00Z')], now)
    expect(g.map(x => [x.day, x.rows.map(r => r.number)])).toEqual([['Today', [1, 2]], ['Yesterday', [3]]])
  })
})
