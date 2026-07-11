import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// The resolver reproduces NuxtHub's static schema barrel. That equivalence
// holds ONLY while nothing in the monorepo registers the `hub:db:schema:extend`
// hook (which would let a layer inject schema paths the static resolver can
// never see). The brief's "hook is used nowhere" claim is a point-in-time grep
// that can silently rot as packages are added — so make it a standing assertion.

const REPO_ROOT = resolve(__dirname, '../../../../..')
const HOOK = 'hub:db:schema:extend'
const SCAN_DIRS = ['packages', 'apps', 'pocs', 'fixtures', 'playground']

describe('repo invariant: hub:db:schema:extend is never registered', () => {
  it('no source file registers the schema-extend hook', () => {
    let matches: string[] = []
    try {
      const out = execFileSync(
        'grep',
        [
          '-rIl', HOOK,
          '--include=*.ts', '--include=*.mjs', '--include=*.js', '--include=*.vue',
          '--exclude-dir=node_modules', '--exclude-dir=.nuxt', '--exclude-dir=dist',
          ...SCAN_DIRS,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )
      matches = out.split('\n').filter(Boolean)
    } catch (err: any) {
      // grep exits 1 with no output when there are zero matches — the pass case.
      if (err.status === 1 && !err.stdout?.toString().trim()) matches = []
      else throw err
    }

    // A string literal is not a registration. Two legitimate mentions exist:
    // the resolver's own doc comment (why it doesn't handle the hook) and this
    // test's HOOK constant. The invariant is about PRODUCTION source, so drop
    // test files and the resolver.
    const offenders = matches.filter(f =>
      !f.endsWith('lib/utils/schema-sources.ts') && !/\.test\.[cm]?ts$/.test(f))
    expect(offenders).toEqual([])
  })
})
