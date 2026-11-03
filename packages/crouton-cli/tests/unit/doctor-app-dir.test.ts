import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { doctor } from '../../lib/doctor.ts'

// #1357 — the dependency check read the packages an app extends from
// process.cwd() instead of the appDir doctor was given. It only worked when the
// caller happened to be inside the app (crouton init's leaked chdir), so
// `crouton doctor apps/x` from the repo root — and init once it stopped leaking
// the chdir — silently checked nothing.
describe('doctor(appDir) from another cwd (#1357)', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'crouton-doctor-')))
    const app = join(root, 'apps/demo')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'crouton.config.js'), 'export default { collections: [] }\n')
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { '@fyit/crouton-core': '*' } }))
    writeFileSync(join(app, 'nuxt.config.ts'), 'export default defineNuxtConfig({ extends: [\'@fyit/crouton-core\', \'@fyit/crouton-bookings\'] })\n')
    // the caller stays where it is (inside this repo, so the module registry
    // finds the package manifests) — NOT inside the app
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('flags an extended package missing from the app\'s dependencies', async () => {
    const result = await doctor(join(root, 'apps/demo'))
    const bookings = result.checks.find(c => /crouton-bookings/.test(`${c.name} ${c.message}`))
    expect(bookings, JSON.stringify(result.checks, null, 2)).toBeDefined()
    expect(bookings!.status).not.toBe('pass')
  })
})
