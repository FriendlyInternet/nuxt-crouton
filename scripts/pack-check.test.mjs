// Tests for scripts/pack-check.mjs (#3393). Run: node --test scripts/pack-check.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkPacked, checkLockstep, configRefs, inTarball, packTargets, undeclaredImports } from './pack-check.mjs'

const clean = {
  pkg: { name: '@fyit/x', version: '0.2.0', main: './nuxt.config.ts', exports: { '.': './nuxt.config.ts', './types': { import: './types/index.ts' } } },
  files: ['package.json', 'nuxt.config.ts', 'types/index.ts', 'app/components/A.vue', 'server/api/a.ts'],
  trackedTopDirs: ['app', 'server', 'types', 'tests'],
  configRefs: ['app/components'],
}

test('a clean fixture returns no problems and no warnings', () => {
  assert.deepEqual(checkPacked(clean), { problems: [], warnings: [] })
})

test('(a) a leftover workspace: or catalog: in the packed package.json is a problem', () => {
  const { problems } = checkPacked({ ...clean, packedJson: '{"dependencies":{"a":"workspace:*","b":"catalog:"}}' })
  assert.ok(problems.some(p => p.includes('workspace:')))
  assert.ok(problems.some(p => p.includes('catalog:')))
})

test('(b) a missing export or bin target is a problem', () => {
  const pkg = { ...clean.pkg, bin: { x: './bin/x.js' }, exports: { ...clean.pkg.exports, './seed': './seed/index.ts' } }
  const { problems } = checkPacked({ ...clean, pkg })
  assert.ok(problems.includes('target bin/x.js is not in the tarball'))
  assert.ok(problems.includes('target seed/index.ts is not in the tarball'))
})

test('(b) a * pattern target needs its prefix folder in the tarball', () => {
  const pkg = { ...clean.pkg, exports: { ...clean.pkg.exports, './schemas/*': './schemas/*' } }
  assert.ok(checkPacked({ ...clean, pkg }).problems.includes('target schemas/* is not in the tarball'))
  assert.deepEqual(checkPacked({ ...clean, pkg, files: [...clean.files, 'schemas/a.json'] }).problems, [])
})

test('(c) a tracked layer folder missing from the tarball is a problem; non-layer folders are not', () => {
  const { problems } = checkPacked({ ...clean, trackedTopDirs: [...clean.trackedTopDirs, 'modules', 'i18n'] })
  assert.deepEqual(problems, ['tracked folder modules/ is not in the tarball', 'tracked folder i18n/ is not in the tarball'])
})

test('(d) dist/ without a prepack/prepare build is a problem', () => {
  const pkg = { ...clean.pkg, exports: { './module': { import: './dist/module.mjs' } } }
  const files = [...clean.files, 'dist/module.mjs']
  assert.ok(checkPacked({ ...clean, pkg, files }).problems.includes('ships dist/ but has no prepack/prepare build'))
  assert.deepEqual(checkPacked({ ...clean, pkg: { ...pkg, scripts: { prepack: 'pnpm run build' } }, files }).problems, [])
})

test('(e) a root module.ts loaded by nuxt.config but not packed is a problem (auth / mcp-toolkit case)', () => {
  const refs = configRefs("const currentDir = fileURLToPath(new URL('.', import.meta.url))\nexport default defineNuxtConfig({ modules: [join(currentDir, 'module.ts')] })")
  assert.deepEqual(refs, ['module.ts'])
  const { problems } = checkPacked({ ...clean, configRefs: refs, sourceExists: () => true })
  assert.deepEqual(problems, ['nuxt.config loads module.ts but the tarball lacks it'])
})

test('(e) an extensionless from \'./config-utils\' not packed is a problem (i18n case)', () => {
  const refs = configRefs("import { getCroutonLocales } from './config-utils'\n")
  assert.deepEqual(refs, ['config-utils'])
  assert.deepEqual(checkPacked({ ...clean, configRefs: refs }).problems, ['nuxt.config loads config-utils but the tarball lacks it'])
  assert.deepEqual(checkPacked({ ...clean, configRefs: refs, files: [...clean.files, 'config-utils.ts'] }).problems, [])
})

test('(e) a config ref missing from the source is a warning, not a problem', () => {
  const { problems, warnings } = checkPacked({ ...clean, configRefs: ['server/utils'], files: ['package.json', 'nuxt.config.ts', 'types/index.ts', 'app/a.vue'], trackedTopDirs: ['app', 'types'], sourceExists: () => false })
  assert.deepEqual(problems, [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /server\/utils/)
})

test('configRefs skips import type and the bare new URL(\'./\')', () => {
  const src = [
    "import type { X } from './types/x'",
    "import { a } from '../shared/a'",
    "const d = fileURLToPath(new URL('./', import.meta.url))",
    "const e = new URL('./runtime/plugin', import.meta.url)",
    "join(currentDir, 'modules/ipx-blob')",
  ].join('\n')
  assert.deepEqual(configRefs(src), ['../shared/a', 'modules/ipx-blob', 'runtime/plugin'])
})

test('inTarball matches a file, a folder, and an extensionless import', () => {
  const files = ['module.ts', 'app/components/A.vue', 'data.json']
  assert.ok(inTarball('module.ts', files))
  assert.ok(inTarball('app/components', files))
  assert.ok(inTarball('module', files))
  assert.ok(inTarball('data', files))
  assert.ok(!inTarball('modules', files))
})

test('packTargets collects exports leaves, main, types and bin', () => {
  assert.deepEqual(packTargets({ main: 'dist/index.js', types: 'dist/index.d.ts', bin: { m: './dist/index.js' }, exports: { '.': { import: './a.mjs', types: './a.d.ts' } } }),
    ['a.d.ts', 'a.mjs', 'dist/index.d.ts', 'dist/index.js'])
})

test('checkLockstep flags one odd version and passes equal versions', () => {
  assert.deepEqual(checkLockstep([{ name: 'a', version: '0.1.0' }, { name: 'b', version: '0.1.0' }]), [])
  const p = checkLockstep([{ name: 'a', version: '0.1.0' }, { name: 'b', version: '0.1.0' }, { name: '@fyit/crouton-maps', version: '0.2.0' }])
  assert.equal(p.length, 1)
  assert.match(p[0], /@fyit\/crouton-maps@0\.2\.0/)
})

test('undeclaredImports finds runtime @fyit imports and ignores types, comments and declared deps', () => {
  const pkg = { name: '@fyit/x', peerDependencies: { '@fyit/crouton-core': 'workspace:*' } }
  const sources = [{ text: [
    "import type { A } from '@fyit/crouton-admin'",
    "// import { b } from '@fyit/crouton-email'",
    "import { c } from '@fyit/crouton-core/shared/x'",
    "import { d } from '@fyit/crouton-auth/server/utils/team'",
    "const m = await import('@fyit/crouton-ai')",
  ].join('\n') }]
  assert.deepEqual(undeclaredImports(pkg, sources), ['@fyit/crouton-ai', '@fyit/crouton-auth'])
})

// The real entry point: the CLI packs a fixture package with pnpm and reports the missing module.ts.
test('CLI packs a fixture repo, fails on a config-loaded file the tarball lacks, passes once it ships', () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-check-fixture-'))
  try {
    const dir = join(root, 'packages', 'crouton-x')
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'app', 'app.vue'), '<template><div /></template>\n')
    writeFileSync(join(dir, 'module.ts'), 'export default {}\n')
    writeFileSync(join(dir, 'nuxt.config.ts'), "import { join } from 'node:path'\nconst currentDir = '.'\nexport default { modules: [join(currentDir, 'module.ts')] }\n")
    const pkg = { name: '@fyit/crouton-x', version: '0.2.0', type: 'module', main: './nuxt.config.ts', files: ['app', 'nuxt.config.ts'] }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    const script = fileURLToPath(new URL('./pack-check.mjs', import.meta.url))
    const run = () => spawnSync(process.execPath, [script], { env: { ...process.env, PACK_CHECK_ROOT: root }, encoding: 'utf8' })

    const bad = run()
    assert.equal(bad.status, 1, bad.stdout + bad.stderr)
    assert.match(bad.stdout, /@fyit\/crouton-x@0\.2\.0: FAIL — nuxt\.config loads module\.ts but the tarball lacks it/)
    assert.match(bad.stdout, /0\/1 ok/)

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, files: [...pkg.files, 'module.ts'] }, null, 2))
    const good = run()
    assert.equal(good.status, 0, good.stdout + good.stderr)
    assert.match(good.stdout, /@fyit\/crouton-x@0\.2\.0: ok/)
    assert.match(good.stdout, /1\/1 ok/)
  }
  finally {
    rmSync(root, { recursive: true, force: true })
  }
})
