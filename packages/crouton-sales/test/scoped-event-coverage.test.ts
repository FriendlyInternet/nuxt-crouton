/**
 * Every till endpoint goes through the team check (#4391).
 *
 * `requireScopedEvent` checks the helper token AND that the event is the
 * token's team's. An endpoint under `events/[eventId]/` that calls
 * `requireScopedAccessToResource` itself (or nothing) skips the team check, so
 * a token for team A could read or change team B's event. This reads every
 * handler there and refuses any that does not call the helper.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../server/api/crouton-sales/events/[eventId]')
const HELPER = resolve(__dirname, '../server/utils/require-scoped-event.ts')

const EXCEPTIONS = [
  // Public: resolves an event by slug before anyone has a token.
  'by-slug/[slug].get.ts',
  // Kitchen screen — until #4388 step 2
  'display-jobs/index.get.ts',
  // Kitchen screen — until #4388 step 2
  'kds-bump.post.ts'
]

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listTs(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

const files = listTs(ROOT).map(path => relative(ROOT, path).split('\\').join('/'))

describe('events/[eventId]/* endpoints use requireScopedEvent', () => {
  it('finds the endpoint files (a moved folder must not pass by finding nothing)', () => {
    expect(files.length).toBeGreaterThan(EXCEPTIONS.length)
  })

  it('every listed exception still exists', () => {
    for (const exception of EXCEPTIONS) {
      expect(existsSync(join(ROOT, exception)), exception).toBe(true)
    }
  })

  it('every non-exempt endpoint imports and calls requireScopedEvent', () => {
    const missing = files
      .filter(file => !EXCEPTIONS.includes(file))
      .filter((file) => {
        const src = readFileSync(join(ROOT, file), 'utf8')
        return !/import\s*\{[^}]*\brequireScopedEvent\b[^}]*\}\s*from/.test(src)
          || !/\brequireScopedEvent\s*\(\s*event\s*\)/.test(src)
      })
    expect(missing).toEqual([])
  })

  it('no endpoint imports requireScopedAccessToResource directly', () => {
    const direct = files
      .filter(file => !EXCEPTIONS.includes(file))
      .filter(file => /\brequireScopedAccessToResource\b/.test(readFileSync(join(ROOT, file), 'utf8')))
    expect(direct).toEqual([])
  })

  it('the helper passes the token\'s team into the event lookup', () => {
    const src = readFileSync(HELPER, 'utf8')
    expect(src).toMatch(/findTeamEvent\(\s*db\s*,\s*salesEvents\s*,\s*eventId\s*,\s*access\.organizationId\s*\)/)
  })
})
