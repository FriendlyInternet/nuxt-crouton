/**
 * Behaviour contract for #1260 — regeneration must not silently destroy edits.
 *
 * crouton's promise is "you own the generated code and can edit it." The generated
 * files even print "Safe to modify - regeneration requires --force flag." Today that
 * promise is false: the writeScaffold() write loop overwrites every file unconditionally.
 *
 * These tests pin the INTENDED behaviour (currently failing):
 *   - regenerate WITHOUT --force preserves a hand-edited file
 *   - regenerate WITHOUT --force still (re)writes files that are absent
 *   - regenerate WITH --force overwrites the hand-edited file
 *   - the run reports which existing files it preserved (not silent)
 *
 * Subprocess-driven, mirroring tests/integration/commands.test.ts.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const exec = promisify(execFile)
const CLI_PATH = resolve(__dirname, '../../bin/crouton-generate.js')

function runCLI(args: string[], cwd: string) {
  return exec('node', [CLI_PATH, ...args], {
    cwd,
    timeout: 60_000,
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

const SCHEMA = JSON.stringify({
  id: { type: 'uuid', meta: { primaryKey: true } },
  title: { type: 'string', meta: { required: true, maxLength: 200 } },
  price: { type: 'decimal', meta: { precision: 10, scale: 2 } }
})

// The dep check reads package.json `dependencies` (not node_modules) — declaring the
// crouton deps here lets `generate` run WITHOUT --force, so --force is free to mean
// exactly one thing in these tests: "overwrite existing files".
const PKG_JSON = JSON.stringify({
  name: 'regen-fixture',
  private: true,
  dependencies: { '@fyit/crouton': '*', '@fyit/crouton-i18n': '*' }
})

// The detector also requires the base layer to be EXTENDED in nuxt.config.ts, not just
// present in package.json — otherwise it reports a critical "installed but not extended".
const NUXT_CONFIG = `export default defineNuxtConfig({ extends: ['@fyit/crouton'] })\n`

const POST_HANDLER =
  'layers/shop/collections/widgets/server/api/teams/[id]/shop-widgets/index.post.ts'
const MARKER = '// >>> HAND EDITED — MUST SURVIVE REGEN <<<'

let dir: string

// NOTE: the direct `generate` command currently exits 1 at the very end due to an
// unrelated known bug (#1246, promptedConfigs ReferenceError) that throws AFTER all
// files are written. So these tests assert on FILE STATE, not exit codes — the write
// loop (and the skip-existing behaviour under test) completes before that crash.
// `--noDb` (camelCase — citty reads `--no-db` as negating a `db` arg) skips the slow
// migration/nuxt-prepare step, which would otherwise time out in a bare temp dir.
async function generate(extraArgs: string[] = []) {
  return runCLI(
    ['generate', 'shop', 'widgets', '--fields-file=widget-schema.json', '--noDb', '--no-tests', ...extraArgs],
    dir
  )
}

async function editHandler() {
  const p = join(dir, POST_HANDLER)
  const src = await readFile(p, 'utf8')
  await writeFile(p, `${MARKER}\n${src}`, 'utf8')
}

async function handlerHasEdit() {
  return (await readFile(join(dir, POST_HANDLER), 'utf8')).includes(MARKER)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crouton-regen-'))
  await writeFile(join(dir, 'package.json'), PKG_JSON, 'utf8')
  await writeFile(join(dir, 'nuxt.config.ts'), NUXT_CONFIG, 'utf8')
  await writeFile(join(dir, 'widget-schema.json'), SCHEMA, 'utf8')
  // Baseline generation runs WITHOUT --force (deps satisfied above). We assert the
  // scaffold was written (file state), not exit code — see the #1246 note above.
  const first = await generate()
  expect(existsSync(join(dir, POST_HANDLER)), `baseline generate did not write files:\n${first.stdout}\n${first.stderr}`).toBe(true)
})

afterEach(async () => {
  if (dir && existsSync(dir)) await rm(dir, { recursive: true, force: true })
})

describe('regeneration preserves hand-edits (#1260)', () => {
  it('regenerate WITHOUT --force keeps a hand-edited file untouched', async () => {
    await editHandler()
    await generate()
    expect(await handlerHasEdit()).toBe(true) // currently FAILS: file is clobbered
  })

  it('regenerate WITHOUT --force reports the files it preserved (not silent)', async () => {
    await editHandler()
    const res = await generate()
    expect(res.stdout + res.stderr).toMatch(/preserv|skip|already exists|--force to overwrite/i)
  })

  it('regenerate WITHOUT --force still (re)writes a file that is absent', async () => {
    await editHandler()
    await rm(join(dir, POST_HANDLER)) // simulate a file that needs to exist but doesn't
    await generate()
    expect(existsSync(join(dir, POST_HANDLER))).toBe(true) // absent file re-created
  })

  it('regenerate WITH --force overwrites the hand-edited file', async () => {
    await editHandler()
    await generate(['--force'])
    expect(await handlerHasEdit()).toBe(false) // --force opts back into overwrite
  })
})
