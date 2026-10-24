import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// #1357 — `crouton init` scaffolds into a RELATIVE appDir (`apps/<name>`), then
// chdir()s into it before generating. The config path was built from that same
// relative appDir, so runConfig re-resolved it against the NEW cwd and doubled
// the prefix (`apps/demo/apps/demo/crouton.config.js`) → "No schema configuration
// found" on every app that already had an approved crouton.config.js. The steps
// after generate (migrations, doctor) took the relative appDir too.

const calls: { configFile?: string, cwdAtGenerate?: string, migrationsDir?: string, doctorDir?: string } = {}

vi.mock('../../lib/scaffold-app.ts', () => ({
  scaffoldApp: vi.fn(async () => ({ files: [], appDir: 'apps/demo' }))
}))
vi.mock('../../lib/generate-collection.ts', () => ({
  // mirrors loadAndPrepareConfig: resolve the given path against the current cwd
  runConfig: vi.fn(async ({ configPath }: { configPath: string }) => {
    calls.configFile = resolve(process.cwd(), configPath)
    calls.cwdAtGenerate = process.cwd()
  })
}))
vi.mock('../../lib/utils/generate-migrations.ts', () => ({
  generateMigrations: vi.fn(async (dir: string) => {
    calls.migrationsDir = resolve(dir)
    return { generated: true }
  }),
  manualMigrationSteps: () => []
}))
vi.mock('../../lib/doctor.ts', () => ({
  doctor: vi.fn(async (dir: string) => {
    calls.doctorDir = resolve(dir)
    return {}
  }),
  printReport: vi.fn()
}))

describe('initApp with a pre-existing crouton.config.js (#1357)', () => {
  let root: string
  let originalCwd: string

  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k as keyof typeof calls]
    originalCwd = process.cwd()
    root = realpathSync(mkdtempSync(join(tmpdir(), 'crouton-init-')))
    mkdirSync(join(root, 'apps/demo'), { recursive: true })
    writeFileSync(join(root, 'apps/demo/crouton.config.js'), 'export default { collections: [] }\n')
    process.chdir(root)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('generates from the app\'s own config file, not a doubled path', async () => {
    const { initApp } = await import('../../lib/init-app.ts')
    await initApp('demo')
    expect(calls.configFile).toBe(join(root, 'apps/demo/crouton.config.js'))
    expect(calls.cwdAtGenerate).toBe(join(root, 'apps/demo'))
  })

  it('runs migrations and doctor against the app dir, and restores the caller\'s cwd', async () => {
    const { initApp } = await import('../../lib/init-app.ts')
    await initApp('demo')
    expect(calls.migrationsDir).toBe(join(root, 'apps/demo'))
    expect(calls.doctorDir).toBe(join(root, 'apps/demo'))
    expect(process.cwd()).toBe(root)
  })
})
