// #3998 — `crouton add` does not create a package's tables. For a package
// with tables it prints the migration commands to run next; the old
// schema-export / migrate steps (dead since 42cbdda59) are gone, not just
// unreachable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import consola from 'consola'

const registry: Record<string, Record<string, any>> = {}

vi.mock('../../lib/module-registry.ts', () => ({
  getModule: async (name: string) => registry[name],
  listModules: async () => Object.entries(registry).map(([alias, m]) => ({ alias, ...m }))
}))

const { addModule } = await import('../../lib/add-module.ts')
const { manualMigrationSteps } = await import('../../lib/utils/generate-migrations.ts')

let dir: string
let cwdSpy: ReturnType<typeof vi.spyOn>
let lines: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crouton-add-'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }))
  await writeFile(join(dir, 'nuxt.config.ts'), "export default defineNuxtConfig({ extends: ['@fyit/crouton-core'] })\n")
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
  lines = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')) })
  consola.mockTypes(() => (...args: unknown[]) => { lines.push(args.join(' ')) })
  for (const k of Object.keys(registry)) delete registry[k]
})

afterEach(async () => {
  vi.restoreAllMocks()
  consola.restoreAll()
  cwdSpy.mockRestore()
  await rm(dir, { recursive: true, force: true })
})

const deadStep = /schema export|applied migrations|Would run: npx nuxt db:migrate|Tables:/i

describe('crouton add — packages with tables (#3998)', () => {
  it('T1: prints every manual migration step for a package with tables, and no dead step', async () => {
    registry.widgets = { package: '@fyit/crouton-widgets', description: 'Widgets', hasSchema: true }
    const result = await addModule('widgets', { dryRun: true })
    expect(result.success).toBe(true)
    const out = lines.join('\n')
    for (const step of manualMigrationSteps()) expect(out).toContain(step)
    expect(lines.filter(l => deadStep.test(l))).toEqual([])
  })

  it('T2: a stale entry with schemaExport + tables triggers no schema-export, migrate or Tables line', async () => {
    registry.widgets = {
      package: '@fyit/crouton-widgets',
      description: 'Widgets',
      hasSchema: true,
      schemaExport: './x',
      tables: ['widgets']
    }
    await addModule('widgets', { dryRun: true })
    expect(lines.filter(l => deadStep.test(l) || /Would add schema export/i.test(l))).toEqual([])
  })

  it('T3: a package without tables prints nothing about tables or migrations', async () => {
    registry.plain = { package: '@fyit/crouton-plain', description: 'Plain', hasSchema: false }
    const result = await addModule('plain', { dryRun: true })
    expect(result.success).toBe(true)
    expect(lines.filter(l => /table|migrat|db:generate/i.test(l))).toEqual([])
  })
})
