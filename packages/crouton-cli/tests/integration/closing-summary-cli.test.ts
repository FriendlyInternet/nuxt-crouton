import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// #1742 — the RULE, at the real entry point: when the migration is soft-deferred,
// the final summary of BOTH `crouton generate` (single collection, via
// writeScaffold → runDatabaseSetup → runMigrationStep) and `crouton config` (via
// runPostGeneration → runDatabaseSetup → runMigrationStep) lists it as numbered
// step 1. A build that drops the migration outcome anywhere on either path fails.
//
// The fixture extends a layer that cannot be resolved before or after the
// resolver fix, so the run defers for real. It lives INSIDE tests/integration
// (under /tmp the duplicate-table check cannot resolve the barrel's
// @fyit/crouton-auth import) and ships server/db/translations-ui.ts (without it
// exportI18nSchema takes the legacy `npx nuxt db generate` path).

const exec = promisify(execFile)
const CLI_PATH = resolve(__dirname, '../../bin/crouton-generate.js')

function runCLI(args: string[], cwd: string) {
  return exec('node', [CLI_PATH, ...args], {
    cwd,
    timeout: 120_000,
    env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' }
  }).then(
    ({ stdout, stderr }) => ({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 }),
    (err: any) => ({
      stdout: (err.stdout as string) ?? '',
      stderr: (err.stderr as string) ?? '',
      exitCode: typeof err.code === 'number' ? err.code : 1
    })
  )
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(__dirname, '.tmp-defer-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'defer-fixture',
    private: true,
    type: 'module',
    dependencies: { '@fyit/crouton-core': '*', '@fyit/crouton-i18n': '*' }
  }, null, 2))
  writeFileSync(join(dir, 'nuxt.config.ts'),
    'export default defineNuxtConfig({ extends: [\'@fyit/crouton-core\', \'@fyit/crouton-does-not-exist\'] })\n')
  writeFileSync(join(dir, 'schema.json'), JSON.stringify({ title: { type: 'string', meta: { required: true } } }))
  mkdirSync(join(dir, 'server', 'db'), { recursive: true })
  writeFileSync(join(dir, 'server/db/translations-ui.ts'), 'export {}\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function expectDeferredClosing(res: { stdout: string, stderr: string, exitCode: number }) {
  const out = res.stdout
  expect(res.exitCode, `stderr:\n${res.stderr}\nstdout:\n${out}`).toBe(0)
  expect(out).toContain('↻ Migration deferred') // the mid-log line stays
  expect(out).not.toContain('✓ Database migration generated')
  expect(out).not.toContain('Next step: Restart') // the old fixed line is gone

  const tail = out.slice(out.lastIndexOf('ALL DONE!') + 'ALL DONE!'.length)
  const lines = tail.split('\n').map(l => l.trim()).filter(l => l && !/^═+$/.test(l))
  expect(lines[0]).toBe('Next steps:')
  expect(lines[1]).toMatch(/^1\. .*pnpm db:generate/)
  expect(lines[1]).toContain('@fyit/crouton-does-not-exist')
  expect(lines[2]).toBe('2. Restart your Nuxt dev server')
}

describe('closing summary lists a postponed migration (#1742)', () => {
  it('crouton generate (single collection) lists the postponed migration as step 1', async () => {
    const res = await runCLI(['generate', 'shop', 'widgets', '--fields-file=schema.json'], dir)
    expectDeferredClosing(res)
  }, 150_000)

  it('crouton config lists the postponed migration as step 1', async () => {
    writeFileSync(join(dir, 'crouton.config.js'), `export default {
  collections: [{ name: 'widgets', fieldsFile: './schema.json' }],
  dialect: 'sqlite',
  targets: [{ layer: 'shop', collections: ['widgets'] }]
}
`)
    const res = await runCLI(['config'], dir)
    expectDeferredClosing(res)
  }, 150_000)
})
