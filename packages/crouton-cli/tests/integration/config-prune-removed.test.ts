/**
 * #226 — removing a collection from crouton.config must not leave dangling
 * references behind. Subprocess-driven (real `crouton config`), `--noDb`.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const exec = promisify(execFile)
const CLI_PATH = resolve(__dirname, '../../bin/crouton-generate.js')

function runCLI(args: string[], cwd: string) {
  return exec('node', [CLI_PATH, ...args], {
    cwd,
    timeout: 90_000,
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

const SCHEMA = JSON.stringify({ title: { type: 'string', meta: { required: true } } })
const PKG = JSON.stringify({
  name: 'prune-fixture',
  private: true,
  dependencies: { '@fyit/crouton-core': '*', '@fyit/crouton-i18n': '*' }
})
const NUXT = `export default defineNuxtConfig({ extends: ['@fyit/crouton-core'] })\n`
const cfg = (cols: string[]) => `export default {
  collections: [${cols.map(c => `{ name: '${c}', fieldsFile: './schema.json' }`).join(', ')}],
  dialect: 'sqlite',
  flags: { noDb: true },
  targets: [{ layer: 'shop', collections: [${cols.map(c => `'${c}'`).join(', ')}] }]
}
`
const BARREL = `export { shopWidgets } from '../../layers/shop/collections/widgets/server/database/schema'
export { shopGadgets } from '../../layers/shop/collections/gadgets/server/database/schema'
`

let dir: string
const FILES = ['server/db/schema.ts', 'app/app.config.ts', 'layers/shop/nuxt.config.ts']

async function read(p: string) {
  for (const c of [p, p.replace('app/app.config.ts', 'app.config.ts')]) {
    if (existsSync(join(dir, c))) return readFile(join(dir, c), 'utf8')
  }
  return ''
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crouton-prune-int-'))
  await writeFile(join(dir, 'package.json'), PKG)
  await writeFile(join(dir, 'nuxt.config.ts'), NUXT)
  await writeFile(join(dir, 'schema.json'), SCHEMA)
  await writeFile(join(dir, 'crouton.config.js'), cfg(['widgets', 'gadgets']))
  const first = await runCLI(['config'], dir)
  expect(first.exitCode, first.stdout + first.stderr).toBe(0)
  // --noDb does not write the barrel; write what a full run would have.
  await mkdir(join(dir, 'server/db'), { recursive: true })
  await writeFile(join(dir, 'server/db/schema.ts'), BARREL)
  await writeFile(join(dir, 'crouton.config.js'), cfg(['widgets']))
}, 120_000)
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('config after removing a collection (#226)', () => {
  it('deleted folder: exits 0 and no file mentions the collection', async () => {
    await rm(join(dir, 'layers/shop/collections/gadgets'), { recursive: true, force: true })
    const res = await runCLI(['config', '--force'], dir)
    expect(res.exitCode, res.stdout + res.stderr).toBe(0)
    for (const f of FILES) expect((await read(f)).toLowerCase(), f).not.toContain('gadgets')
  }, 120_000)

  it('folder kept: warns to use rollback and leaves the entries', async () => {
    const res = await runCLI(['config', '--force'], dir)
    expect(res.exitCode, res.stdout + res.stderr).toBe(0)
    expect(res.stdout).toContain('crouton rollback shop gadgets')
    expect(await read('server/db/schema.ts')).toContain('shopGadgets')
    expect(await read('layers/shop/nuxt.config.ts')).toContain('gadgets')
  }, 120_000)
})
