// #3392 — `crouton init` / `scaffold-app` outside the crouton monorepo installs from npm:
// `./<name>`, `^<cli version>` for every @fyit/* dep, no Cloudflare unless --cf.
// Inside the monorepo the output stays exactly what it was (T3 is main's package.json).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { isCroutonMonorepo, scaffoldApp } from '../../lib/scaffold-app.ts'

const here = dirname(fileURLToPath(import.meta.url))
const cliDir = resolve(here, '..', '..')
const repoRoot = resolve(cliDir, '..', '..')
const cliPkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'))
const caret = `^${cliPkg.version}`

const tmpDirs: string[] = []
function emptyTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'crouton-standalone-'))
  tmpDirs.push(d)
  return d
}
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

const find = (files: Array<{ path: string, content: string }>, p: string) => files.find(f => f.path === p)?.content
const fyitEntries = (pkg: any) => Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([k]) => k.startsWith('@fyit/'))

describe('scaffoldApp standalone mode (#3392)', () => {
  it('T1 — empty folder: ./<name>, ^<cli version> deps, no wrangler, local sqlite', async () => {
    const result = await scaffoldApp('my-app', { dryRun: true, cwd: emptyTmp() })
    expect(result.appDir).toBe('my-app')
    expect(result.standalone).toBe(true)
    expect(result.cf).toBe(false)
    const raw = find(result.files, 'package.json')!
    expect(raw).not.toContain('workspace:')
    expect(raw).not.toContain('catalog:')
    const pkg = JSON.parse(raw)
    const fyit = fyitEntries(pkg)
    expect(fyit.map(([k]) => k)).toEqual(expect.arrayContaining(['@fyit/crouton-core', '@fyit/crouton-i18n', '@fyit/crouton-cli', '@fyit/crouton-devtools']))
    for (const [, v] of fyit) expect(v).toBe(caret)
    expect(pkg.devDependencies.wrangler).toBeUndefined()
    expect(find(result.files, 'wrangler.jsonc')).toBeUndefined()
    expect(find(result.files, 'nuxt.config.ts')).toContain("db: 'sqlite'")
  })

  it('T2 — --cf outside the repo adds wrangler + wrangler.jsonc, deps still ^<cli version>', async () => {
    const result = await scaffoldApp('my-app', { dryRun: true, cwd: emptyTmp(), cf: true })
    expect(result.cf).toBe(true)
    const pkg = JSON.parse(find(result.files, 'package.json')!)
    expect(pkg.devDependencies.wrangler).toBeDefined()
    expect(find(result.files, 'wrangler.jsonc')).toBeDefined()
    for (const [, v] of fyitEntries(pkg)) expect(v).toBe(caret)
  })

  it('T3 — inside the monorepo: apps/<name> + workspace:* exactly as before', async () => {
    const result = await scaffoldApp('my-app', { dryRun: true, cwd: repoRoot })
    expect(result.standalone).toBe(false)
    expect(result.appDir).toBe('apps/my-app')
    const pkg = JSON.parse(find(result.files, 'package.json')!)
    for (const [, v] of fyitEntries(pkg)) expect(v).toBe('workspace:*')
    expect(pkg.devDependencies.wrangler).toBeDefined()
    // Captured from main's `scaffoldApp('my-app', { dryRun: true })` before #3392.
    expect(pkg).toEqual({
      name: 'my-app',
      type: 'module',
      private: true,
      version: '0.1.0',
      scripts: {
        'build': 'nuxt build',
        'dev': 'nuxt dev',
        'generate': 'nuxt generate',
        'preview': 'nuxt preview',
        'typecheck': 'nuxt typecheck',
        'test': 'vitest run',
        'postinstall': 'nuxt prepare 2>/dev/null || true',
        'cf:deploy': 'NITRO_PRESET=cloudflare_module nuxt build && npx wrangler --cwd .output deploy && node scripts/sync-wrangler-ids.mjs && npx wrangler d1 migrations apply my-app-db --remote',
        'cf:staging': 'NUXT_PUBLIC_CROUTON_REVIEW=true NITRO_PRESET=cloudflare_module nuxt build && node scripts/inject-wrangler-env.mjs && npx wrangler deploy --config .output/server/wrangler.json --env staging && node scripts/sync-wrangler-ids.mjs && node scripts/inject-wrangler-env.mjs && npx wrangler d1 migrations apply my-app-staging-db --env staging --remote',
        'sync:ids': 'node scripts/sync-wrangler-ids.mjs',
        'db:generate': 'drizzle-kit generate',
        'db:migrate': 'npx wrangler d1 migrations apply my-app-db --local',
        'db:migrate:prod': 'npx wrangler d1 migrations apply my-app-db --remote',
        'db:migrate:staging': 'npx wrangler d1 migrations apply my-app-staging-db --env staging --remote'
      },
      dependencies: {
        '@fyit/crouton-core': 'workspace:*',
        '@fyit/crouton-i18n': 'workspace:*',
        '@libsql/client': '^0.17.0',
        'drizzle-orm': '^0.45.1',
        'nuxt': '^4.2.2',
        'vue': '^3.5.26',
        'vue-router': '^4.6.4'
      },
      devDependencies: {
        '@fyit/crouton-cli': 'workspace:*',
        '@fyit/crouton-devtools': 'workspace:*',
        'drizzle-kit': '^0.31.0',
        'vitest': '^2.1.0',
        'wrangler': '^4.64.0'
      }
    })
  })

  it('T4 — --out wins in both modes', async () => {
    const outside = await scaffoldApp('my-app', { dryRun: true, cwd: emptyTmp(), outDir: 'custom/dir' })
    expect(outside.appDir).toBe('custom/dir')
    for (const [, v] of fyitEntries(JSON.parse(find(outside.files, 'package.json')!))) expect(v).toBe(caret)
    const inside = await scaffoldApp('my-app', { dryRun: true, cwd: repoRoot, outDir: 'custom/dir' })
    expect(inside.appDir).toBe('custom/dir')
  })

  it('T5 — bin.crouton-cli points at the same file as bin.crouton (npx @fyit/crouton-cli)', () => {
    expect(cliPkg.bin['crouton-cli']).toBeDefined()
    expect(cliPkg.bin['crouton-cli']).toBe(cliPkg.bin.crouton)
  })

  it('T6 — isCroutonMonorepo detects the repo, not any pnpm workspace', async () => {
    expect(await isCroutonMonorepo(cliDir)).toBe(true)
    expect(await isCroutonMonorepo(emptyTmp())).toBe(false)
    const other = emptyTmp()
    writeFileSync(join(other, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    mkdirSync(join(other, 'packages', 'something'), { recursive: true })
    expect(await isCroutonMonorepo(other)).toBe(false)
  })

  it('T8 — the CLI declares drizzle-orm and installs from npm (no workspace:/catalog: deps)', () => {
    expect(cliPkg.dependencies['drizzle-orm']).toBeDefined()
    for (const v of Object.values(cliPkg.dependencies) as string[]) {
      expect(v.startsWith('workspace:')).toBe(false)
      expect(v.startsWith('catalog:')).toBe(false)
    }
  })
})
