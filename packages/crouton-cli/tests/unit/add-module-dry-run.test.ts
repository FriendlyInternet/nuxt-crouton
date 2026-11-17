// #3998 — `crouton add` does not create a package's tables. For a package
// with tables it prints the migration commands to run next; the old
// schema-export / migrate steps (dead since 42cbdda59) are gone, not just
// unreachable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import consola from 'consola'

const registry: Record<string, Record<string, any>> = {}

// Fake entries win; anything else falls through to the REAL registry
// (built from the packages' crouton.manifest.ts files).
vi.mock('../../lib/module-registry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/module-registry.ts')>()
  return {
    getModule: async (name: string) => registry[name] ?? actual.getModule(name),
    listModules: async () => Object.entries(registry).map(([alias, m]) => ({ alias, ...m }))
  }
})

const { addModule, shipsSchemaFiles } = await import('../../lib/add-module.ts')
const { manualMigrationSteps } = await import('../../lib/utils/generate-migrations.ts')

// A tmp app dir INSIDE the monorepo, so manifest discovery and the
// package lookup find the real packages/ (the monorepo-dev path).
const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const inRepoApp = async () => mkdtemp(join(cliDir, 'tests', '.tmp-add-'))

let dir: string
let cwdSpy: ReturnType<typeof vi.spyOn>
let lines: string[]
let useRepoDir = false

beforeEach(async (ctx) => {
  useRepoDir = ctx.task.name.startsWith('REAL')
  dir = useRepoDir ? await inRepoApp() : await mkdtemp(join(tmpdir(), 'crouton-add-'))
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

  it('REAL: add layout --dry-run prints the migration steps (schema folder, no collections)', async () => {
    const result = await addModule('layout', { dryRun: true })
    expect(result.success).toBe(true)
    const out = lines.join('\n')
    expect(out).toContain('has database tables')
    for (const step of manualMigrationSteps()) expect(out).toContain(step)
  })

  it('REAL: a package with collections (assets) still prints the migration steps', async () => {
    const result = await addModule('assets', { dryRun: true })
    expect(result.success).toBe(true)
    const out = lines.join('\n')
    expect(out).toContain('has database tables')
    for (const step of manualMigrationSteps()) expect(out).toContain(step)
  })

  it('REAL: add flow and add printing --dry-run print the migration steps (only server/db/schema.ts)', async () => {
    for (const name of ['flow', 'printing']) {
      lines.length = 0
      const result = await addModule(name, { dryRun: true })
      expect(result.success).toBe(true)
      const out = lines.join('\n')
      expect(out).toContain('has database tables')
      for (const step of manualMigrationSteps()) expect(out).toContain(step)
    }
  })

  it('REAL: add maps --dry-run (no database tables) prints no table or migration line', async () => {
    const result = await addModule('maps', { dryRun: true })
    expect(result.success).toBe(true)
    expect(lines.filter(l => /table|migrat|db:generate/i.test(l))).toEqual([])
  })
})

describe('shipsSchemaFiles (#3998)', () => {
  let pkg: string
  beforeEach(async () => { pkg = await mkdtemp(join(tmpdir(), 'crouton-pkg-')) })
  afterEach(async () => { await rm(pkg, { recursive: true, force: true }) })

  it('is false with no schema folder', () => {
    expect(shipsSchemaFiles(pkg)).toBe(false)
  })

  it('is true for a .ts file in server/database/schema/ or server/db/schema/', async () => {
    await mkdir(join(pkg, 'server/db/schema'), { recursive: true })
    await writeFile(join(pkg, 'server/db/schema/things.ts'), '')
    expect(shipsSchemaFiles(pkg)).toBe(true)
    const other = await mkdtemp(join(tmpdir(), 'crouton-pkg-'))
    await mkdir(join(other, 'server/database/schema'), { recursive: true })
    await writeFile(join(other, 'server/database/schema/things.ts'), '')
    expect(shipsSchemaFiles(other)).toBe(true)
    await rm(other, { recursive: true, force: true })
  })

  it('is true for a single server/db/schema.ts file', async () => {
    await mkdir(join(pkg, 'server/db'), { recursive: true })
    await writeFile(join(pkg, 'server/db/schema.ts'), 'export {}')
    expect(shipsSchemaFiles(pkg)).toBe(true)
  })

  it('does not count test files or __tests__ folders', async () => {
    const schema = join(pkg, 'server/database/schema')
    await mkdir(join(schema, '__tests__'), { recursive: true })
    await writeFile(join(schema, '__tests__/things.ts'), '')
    await writeFile(join(schema, 'things.test.ts'), '')
    await writeFile(join(schema, 'README.md'), '')
    expect(shipsSchemaFiles(pkg)).toBe(false)
  })
})
