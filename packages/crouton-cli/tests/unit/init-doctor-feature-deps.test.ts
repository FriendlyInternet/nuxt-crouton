import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffoldApp } from '../../lib/scaffold-app.ts'
import { doctor } from '../../lib/doctor.ts'

// #4291 — R7: an app written by `crouton init --site` must pass `crouton doctor`'s
// dependency check. The app dir must sit INSIDE the repo: only there can doctor
// find @fyit/crouton-pages in root node_modules and walk into its `extends`
// (pages → editor), which is where the missing dependency showed up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const cacheDir = join(repoRoot, 'node_modules/.cache/crouton-cli-tests')

describe('crouton init --site then doctor (#4291)', () => {
  let dir: string

  beforeEach(() => {
    mkdirSync(cacheDir, { recursive: true })
    dir = mkdtempSync(join(cacheDir, 'site-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // covers: T2 (R7)
  it('reports no "extends … not in dependencies" failure', async () => {
    await scaffoldApp('demo-x', { site: true, cf: false, outDir: dir })
    const result = await doctor(dir)
    const missing = result.checks.filter(c => /extends .* but it is not in dependencies/.test(c.message))
    expect(missing, JSON.stringify(result.checks, null, 2)).toEqual([])
  }, 60_000)
})
