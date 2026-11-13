import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const run = () => spawnSync('node', ['scripts/gen-api-reference.mjs', '--check'], { encoding: 'utf8' })

// Needs `typescript` + `vue-component-meta`, so it runs in a job that installs packages (not the bare-Node set).
// Print stderr on a wrong exit code: the status alone hid the real error in CI.
const expectStatus = (r, want) => assert.equal(r.status, want, `exit ${r.status}, wanted ${want}. stderr:\n${r.stderr}`)

// Change a source file, expect `--check` to flag `page`, then restore the file.
function expectStaleAfter(file, from, to, page) {
  const orig = readFileSync(file, 'utf8')
  assert.ok(orig.includes(from), `${file} no longer contains ${JSON.stringify(from)} — update this test`)
  try {
    writeFileSync(file, orig.replace(from, to))
    const r = run()
    expectStatus(r, 1)
    assert.match(r.stderr, page)
  } finally {
    writeFileSync(file, orig)
  }
}

const readPage = name => readFileSync(new URL(`../docs/content/8.api-reference/${name}`, import.meta.url), 'utf8')

test('committed api-reference pages match the code', () => {
  expectStatus(run(), 0)
})

test('--check fails when a component prop is renamed', () => {
  expectStaleAfter('packages/crouton-core/app/components/ConfirmButton.vue', 'confirmLabel?: string', 'confirmText?: string', /components\.md/)
})

test('composables page lists default-exported composables', () => {
  const page = readPage('composables.md')
  for (const n of ['useCrouton', 'useCroutonError', 'useCroutonRedirects', 'useCollections']) {
    assert.match(page, new RegExp(`^## ${n}$`, 'm'))
  }
})

test('--check fails when a config key is renamed', () => {
  expectStaleAfter('packages/crouton-sales/crouton.manifest.ts', `'print.enabled': {`, `'printing.enabled': {`, /config-keys\.md/)
})

test('--check fails when a type member is renamed', () => {
  expectStaleAfter('packages/crouton-core/app/types/table.ts', '  pageSize: number', '  perPage: number', /types\.md/)
})

test('--check fails when a server util is renamed', () => {
  expectStaleAfter('packages/crouton-core/server/utils/slug.ts', 'function findUniqueSlug(', 'function findFreeSlug(', /server\.md/)
})

test('--check fails when a server interface member is renamed', () => {
  expectStaleAfter('packages/crouton-auth/server/utils/auth.ts', 'export interface AuthContext {\n  user: User', 'export interface AuthContext {\n  currentUser: User', /server\.md/)
})

test('types and server pages name every export the TypeScript checker sees', () => {
  const ts = createRequire(import.meta.url)('typescript')
  const groups = [
    ['types.md', ['packages/crouton-core/app/types']],
    ['server.md', ['packages/crouton-core/server/utils', 'packages/crouton-auth/server/utils']]
  ]
  const fileToPage = new Map()
  for (const [page, dirs] of groups) {
    for (const d of dirs) for (const f of readdirSync(d).filter(x => x.endsWith('.ts'))) fileToPage.set(`${d}/${f}`, page)
  }
  const program = ts.createProgram([...fileToPage.keys()], { noEmit: true, types: [], skipLibCheck: true })
  const checker = program.getTypeChecker()
  const pages = Object.fromEntries(groups.map(([p]) => [p, readPage(p)]))
  const missing = []
  for (const [file, page] of fileToPage) {
    const sym = checker.getSymbolAtLocation(program.getSourceFile(file))
    assert.ok(sym, `no module symbol for ${file}`)
    for (const e of checker.getExportsOfModule(sym)) {
      const n = e.getName()
      const named = new RegExp(`^#{2,3} ${n}$`, 'm').test(pages[page]) || pages[page].includes('`' + n + '`')
      if (!named) missing.push(`${file}:${n}`)
    }
  }
  assert.deepEqual(missing, [], `exports missing from their page:\n${missing.join('\n')}`)
})

test('server page lists list-exported utils and server types', () => {
  const page = readPage('server.md')
  for (const h of ['## encryptSecret', '## decryptSecret', '## maskSecret', '## isEncryptedSecret', '### AuthContext', '### RedeemGrantResult']) {
    assert.match(page, new RegExp(`^${h}$`, 'm'))
  }
})

// ── component-names (#3898): every manifest component name is one Nuxt registers ────────────
// In this file (not their own) so they never overlap the manifest-rewriting tests above. The
// --fresh test runs first and writes every .nuxt/components.d.ts; the tests after it reuse them.
const names = (...args) => spawnSync('node', ['scripts/component-names.mjs', ...args], { encoding: 'utf8' })
const listed = (pkg) => {
  const r = names('--list', pkg)
  expectStatus(r, 0)
  return r.stdout.split('\n').filter(Boolean).map(l => l.split('\t')[0])
}

// Change `file`, run `runner`, restore the file whatever happens; returns the run's result.
function mutateAndRun(file, from, to, runner) {
  const orig = readFileSync(file, 'utf8')
  assert.ok(orig.includes(from), `${file} no longer contains ${JSON.stringify(from)} — update this test`)
  try {
    writeFileSync(file, orig.replace(from, to))
    return runner()
  } finally {
    writeFileSync(file, orig)
  }
}

test('component-names --check --fresh passes on the clean tree', () => {
  const r = names('--check', '--fresh')
  expectStatus(r, 0)
  assert.match(r.stdout, /^70 components named, 0 without a file$/m)
})

test('--list crouton-calendar names exactly Month and Week', () => {
  assert.deepEqual(listed('crouton-calendar'), ['CroutonCalendarMonth', 'CroutonCalendarWeek'])
})

test('--list resolves pathPrefix, cross-package and stub cases', () => {
  const admin = listed('crouton-admin')
  assert.ok(admin.includes('StatsCard'), 'crouton-admin (pathPrefix: false) should list StatsCard')
  assert.ok(!admin.includes('AdminStatsCard'), 'crouton-admin should not list AdminStatsCard')
  assert.ok(listed('crouton-auth').includes('CroutonUserPill'))
  assert.ok(listed('crouton-bookings').includes('CroutonBookingsPanel'))
  assert.ok(!listed('crouton-core').includes('CroutonAssetsPicker'), 'a stubs/ component must not count')
})

test('--check fails on a manifest name with no component', () => {
  const r = mutateAndRun('packages/crouton-calendar/crouton.manifest.ts', "name: 'CroutonCalendarWeek'", "name: 'CroutonCalendarWeekX'", () => names('--check'))
  expectStatus(r, 1)
  assert.match(r.stderr, /crouton-calendar: manifest names CroutonCalendarWeekX/)
})
