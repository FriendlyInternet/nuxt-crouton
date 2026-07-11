import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

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
    // Only scan dirs that exist in this checkout. GNU grep (Linux CI) exits 2 on
    // a missing dir even when it found matches elsewhere; BSD grep (macOS) does
    // not — filtering keeps the check portable. `playground` isn't always present.
    const dirs = SCAN_DIRS.filter(d => existsSync(join(REPO_ROOT, d)))
    let out = ''
    try {
      out = execFileSync(
        'grep',
        [
          '-rIl', HOOK,
          '--include=*.ts', '--include=*.mjs', '--include=*.js', '--include=*.vue',
          '--exclude-dir=node_modules', '--exclude-dir=.nuxt', '--exclude-dir=dist',
          ...dirs,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )
    } catch (err: any) {
      // grep exits 1 (no matches) → empty stdout; any stdout it produced before
      // a non-zero exit is still the match list, so read it either way.
      out = err.stdout?.toString() ?? ''
    }
    const matches = out.split('\n').filter(Boolean)

    // A string literal is not a registration. Two legitimate mentions exist:
    // the resolver's own doc comment (why it doesn't handle the hook) and this
    // test's HOOK constant. The invariant is about PRODUCTION source, so drop
    // test files and the resolver.
    const offenders = matches.filter(f =>
      !f.endsWith('lib/utils/schema-sources.ts') && !/\.test\.[cm]?ts$/.test(f))
    expect(offenders).toEqual([])
  })
})
