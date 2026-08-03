import { describe, it, expect, vi } from 'vitest'
import { runSeedChunks } from '../../lib/seed-app'

// #1370 — the snippets dogfood: `@fyit/crouton` bundles crouton-bookings transitively, so the
// seed discovered a bookings provider even though the app never extended bookings (no
// `bookings_settings` table). As ONE atomic --command that aborted the whole seed. runSeedChunks
// runs each chunk independently so a dormant-package failure warns + skips and the rest still land.
describe('runSeedChunks', () => {
  it('a failing chunk (missing table) is skipped; every other chunk still runs', () => {
    const ran: string[] = []
    const run = (sql: string) => {
      ran.push(sql)
      if (sql.includes('bookings_settings')) {
        throw new Error('no such table: bookings_settings: SQLITE_ERROR [code: 7500]')
      }
    }
    const chunks = [
      { label: 'provider:auth', sql: "INSERT INTO organization ... 'test1'" },
      { label: 'provider:bookings', sql: 'INSERT INTO bookings_settings ...' },
      { label: 'collection-fixtures', sql: 'INSERT INTO main_snippets ...' },
      { label: 'default-layout', sql: 'INSERT INTO layout_configs ...' },
    ]
    const { ok, skipped } = runSeedChunks(chunks, run)

    expect(ok).toBe(3) // auth + fixtures + layout
    expect(skipped).toEqual(['provider:bookings'])
    // ALL chunks were attempted — the bookings failure did not short-circuit the ones after it.
    expect(ran).toHaveLength(4)
    expect(ran.some(s => s.includes('main_snippets'))).toBe(true) // the app's own rows DID seed
  })

  it('all-good → ok=count, nothing skipped', () => {
    const run = vi.fn()
    const { ok, skipped } = runSeedChunks(
      [{ label: 'a', sql: 'x' }, { label: 'b', sql: 'y' }],
      run,
    )
    expect(ok).toBe(2)
    expect(skipped).toEqual([])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('empty chunk list → ok=0, nothing skipped (caller decides "nothing to seed")', () => {
    const { ok, skipped } = runSeedChunks([], () => {})
    expect(ok).toBe(0)
    expect(skipped).toEqual([])
  })
})
