import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import consola from 'consola'

// #4377 — `crouton init` with a config that HAS collections, where generate throws,
// used to print "Generate skipped (no collections in config yet)". This drives the
// real initApp entry point and checks the printed step-2/3 lines say "failed".

const state = { migrationsCalled: false }

vi.mock('../../lib/scaffold-app.ts', () => ({
  scaffoldApp: vi.fn(async () => ({ files: [], appDir: 'apps/demo', cf: true }))
}))
vi.mock('../../lib/generate-collection.ts', () => ({
  runConfig: vi.fn(async () => {
    throw new Error('boom: schema not found')
  })
}))
vi.mock('../../lib/utils/generate-migrations.ts', () => ({
  generateMigrations: vi.fn(async () => {
    state.migrationsCalled = true
    return { generated: true }
  }),
  manualMigrationSteps: () => []
}))
vi.mock('../../lib/doctor.ts', () => ({
  loadCroutonConfig: vi.fn(async () => ({ collections: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })),
  doctor: vi.fn(async () => ({})),
  printReport: vi.fn()
}))

describe('initApp when generate fails on a config with collections (#4377)', () => {
  let root: string
  let originalCwd: string
  let printed: string[]

  beforeEach(() => {
    state.migrationsCalled = false
    printed = []
    originalCwd = process.cwd()
    root = realpathSync(mkdtempSync(join(tmpdir(), 'crouton-init-fail-')))
    mkdirSync(join(root, 'apps/demo'), { recursive: true })
    writeFileSync(join(root, 'apps/demo/crouton.config.js'), 'export default { collections: [] }\n')
    process.chdir(root)
    const record = (...args: unknown[]) => { printed.push(args.map(String).join(' ')) }
    vi.spyOn(console, 'log').mockImplementation(record)
    for (const level of ['warn', 'success', 'start', 'info', 'error'] as const) {
      vi.spyOn(consola, level).mockImplementation(record as never)
    }
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('prints "Generate failed" with the count and error, never "no collections"', async () => {
    const { initApp } = await import('../../lib/init-app.ts')
    await initApp('demo')
    const out = printed.join('\n')
    expect(out).toContain('Step 2/4 — Generate failed (3 collections): boom: schema not found')
    expect(out).toContain('Step 3/4 — Generate failed — skipping migrations')
    expect(out).not.toContain('no collections in config yet')
    expect(out).not.toContain('No collections generated')
    expect(out).not.toContain('Collections generated')
  })

  it('skips migrations and restores the caller\'s cwd', async () => {
    const { initApp } = await import('../../lib/init-app.ts')
    await initApp('demo')
    expect(state.migrationsCalled).toBe(false)
    expect(process.cwd()).toBe(root)
  })
})
