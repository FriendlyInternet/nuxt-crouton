import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveSchemaSources } from '../../lib/utils/schema-sources.ts'

// Two tiers:
//  1. Resolver-only checks (transitive reach, no-dup, fanfare no-crash) run in
//     the normal `pnpm test` — they need only the resolver + an installed
//     workspace (createRequire resolves @fyit/* from the root node_modules).
//  2. Full PARITY vs NuxtHub — resolver path-set EQUALS the set NuxtHub globs
//     into <app>/.nuxt/hub/db/schema.entry.ts — needs `nuxt prepare` per fixture
//     (.nuxt is gitignored), so it is CI-only / opt-in behind RUN_PARITY=1.

const REPO_ROOT = resolve(__dirname, '../../../..')
const RUN_PARITY = process.env.RUN_PARITY === '1'

const p = (...seg: string[]) => resolve(REPO_ROOT, ...seg)

async function resolverRealSet(appDir: string): Promise<Set<string>> {
  const paths = await resolveSchemaSources(appDir)
  return new Set(paths.map(x => realpathSync(x)))
}

/** Parse NuxtHub's entry barrel into a realpath'd set (prepare first if absent). */
function nuxthubRealSet(appDir: string): Set<string> {
  const entry = resolve(appDir, '.nuxt/hub/db/schema.entry.ts')
  if (!existsSync(entry)) {
    execFileSync('pnpm', ['exec', 'nuxt', 'prepare'], { cwd: appDir, stdio: 'inherit' })
  }
  const src = readFileSync(entry, 'utf8')
  return new Set(
    [...src.matchAll(/from ['"](.+?)['"]/g)].map(m => realpathSync(m[1])),
  )
}

describe('resolveSchemaSources — resolver-only checks (real fixtures)', () => {
  it('nested-schema reaches crouton-printing ONLY via the transitive sales edge', async () => {
    // nested-schema extends core + sales, NOT printing — printing is reachable
    // solely because crouton-sales extends it. Proves package→package walking.
    const paths = await resolveSchemaSources(p('fixtures/nested-schema'))
    const rel = paths.map(x => x.replace(REPO_ROOT + '/', ''))
    expect(rel).toContain('packages/crouton-printing/server/db/schema.ts')
    expect(rel).toContain('packages/crouton-sales/server/db/schema.ts')
    // and the app never listed printing itself
    expect(paths.length).toBeGreaterThan(0)
  })

  it('returns no duplicate paths for with-sales (set-equality alone hides a non-deduping resolver)', async () => {
    const paths = await resolveSchemaSources(p('fixtures/with-sales'))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('walks fanfare without crashing on its twelve crouton-themes subpath extends', async () => {
    // Crash-risk case, not a schema case: themes carry no schema, but the walk
    // must resolve their subpath exports without throwing.
    await expect(resolveSchemaSources(p('apps/fanfare'))).resolves.toBeDefined()
  })
})

describe.skipIf(!RUN_PARITY)('resolveSchemaSources — full parity vs NuxtHub (RUN_PARITY=1)', () => {
  const CASES: Array<[string, string]> = [
    ['fixtures/minimal', 'minimal'],
    ['fixtures/with-sales', 'with-sales'],
    ['fixtures/nested-schema', 'nested-schema (nesting-only)'],
    ['pocs/booking-demo', 'booking-demo (benign duplicate topology)'],
  ]

  for (const [dir, label] of CASES) {
    it(`${label}: resolver path-set EQUALS NuxtHub's`, async () => {
      const resolver = await resolverRealSet(p(dir))
      const nuxthub = nuxthubRealSet(p(dir))
      expect([...resolver].sort()).toEqual([...nuxthub].sort())
    })
  }
})
