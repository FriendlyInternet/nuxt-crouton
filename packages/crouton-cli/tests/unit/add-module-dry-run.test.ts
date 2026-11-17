// #3998 — `crouton add` does not create a package's tables. It does not try
// to detect which packages have tables either: for EVERY package it prints
// one fixed block saying so, followed by the manual migration commands. The
// old schema-export / migrate steps (dead since 42cbdda59) are gone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
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

const { addModule } = await import('../../lib/add-module.ts')
const { manualMigrationSteps } = await import('../../lib/utils/generate-migrations.ts')

// A tmp app dir INSIDE the monorepo, so manifest discovery finds the real
// packages/ (the monorepo-dev path).
const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let dir: string
let cwdSpy: ReturnType<typeof vi.spyOn>
let lines: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(cliDir, 'tests', '.tmp-add-'))
  // core, auth and catalog installed, so packages that depend on them (bookings) get past the dependency check.
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { '@fyit/crouton-core': '*', '@fyit/crouton-auth': '*', '@fyit/crouton-catalog': '*' } }))
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

const BLOCK_HEAD = 'crouton add does not create database tables. If this package brings tables, run next:'

// Asserts the fixed block appears exactly once (head line, then each
// manualMigrationSteps() command in order), and that NO other line says or
// implies tables, a schema export or migrations were handled.
function expectFixedBlockOnce(out: string[]) {
  const heads = out.map((l, i) => (l.includes(BLOCK_HEAD) ? i : -1)).filter(i => i >= 0)
  expect(heads).toHaveLength(1)
  const steps = manualMigrationSteps()
  const at = heads[0]!
  steps.forEach((step, k) => expect(out[at + 1 + k]?.trim()).toBe(step))
  const blockIdx = new Set([at, ...steps.map((_, k) => at + 1 + k)])
  const rest = out.filter((_, i) => !blockIdx.has(i))
  expect(rest.filter(l => /table|schema|migrat|db:generate|db:migrate/i.test(l))).toEqual([])
}

describe('crouton add — fixed "no tables created" block (#3998)', () => {
  for (const name of ['events', 'layout', 'bookings', 'maps']) {
    it(`REAL: add ${name} --dry-run prints the fixed block once and claims nothing about tables`, async () => {
      const result = await addModule(name, { dryRun: true })
      expect(result.success).toBe(true)
      expectFixedBlockOnce(lines)
    })
  }

  it('T2: a stale entry with schemaExport + tables triggers no schema-export, migrate or Tables line', async () => {
    registry.widgets = {
      package: '@fyit/crouton-widgets',
      description: 'Widgets',
      hasSchema: true,
      schemaExport: './x',
      tables: ['widgets']
    }
    const result = await addModule('widgets', { dryRun: true })
    expect(result.success).toBe(true)
    expectFixedBlockOnce(lines)
  })
})
