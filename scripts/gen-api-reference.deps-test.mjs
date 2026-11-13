import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

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

// ── reader trial (#3899): can vue-component-meta read other packages' components? ─────────
// Measures only: prints one line per package; the one assertion is crouton-calendar.
// Runs after the --check --fresh test above, so every .nuxt/components.d.ts already exists.
const readerReq = createRequire(import.meta.url)
// Same compiler options as gen-api-reference.mjs propsOf.
const READER_OPTS = { strict: true, skipLibCheck: true, module: 'esnext', moduleResolution: 'bundler', target: 'esnext' }
const IMPORT_RE = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm
const SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/g

// Static import specifiers in a .vue file's <script> blocks.
const importsOf = abs => [...readFileSync(abs, 'utf8').matchAll(SCRIPT_RE)].flatMap(([, s]) => [...s.matchAll(IMPORT_RE)].map(m => m[1]))

// Non-global props of one component, or the first line of the error the reader threw.
function readProps(checker, abs) {
  try {
    return { props: checker.getComponentMeta(abs).props.filter(x => !x.global) }
  } catch (e) {
    return { error: String(e?.message ?? e).split('\n')[0] }
  }
}

// Read every component `--list` gives for `pkg`; returns per-component results plus unresolved imports.
function readPackage(pkg) {
  const ts = readerReq('typescript')
  const { createCheckerByJson } = readerReq('vue-component-meta')
  const tsOpts = ts.convertCompilerOptionsFromJson(READER_OPTS, process.cwd()).options
  const r = names('--list', pkg)
  expectStatus(r, 0)
  const dir = join(process.cwd(), 'packages', pkg)
  const checker = createCheckerByJson(dir, { include: [join(dir, '**/*.vue')], compilerOptions: READER_OPTS }, {})
  const rows = r.stdout.split('\n').filter(Boolean).map(l => l.split('\t'))
  const results = rows.map(([name, file]) => ({ name, file, ...readProps(checker, join(dir, file)) }))
  const unresolved = new Set(rows.flatMap(([, file]) => {
    const abs = join(dir, file)
    return importsOf(abs).filter(spec => !ts.resolveModuleName(spec, abs, tsOpts, ts.sys).resolvedModule)
  }))
  return { results, unresolved }
}

function reportPackage(pkg, { results, unresolved }) {
  const ok = results.filter(x => x.props)
  const props = ok.flatMap(x => x.props)
  const any = props.filter(x => x.type === 'any').length
  console.log(`${pkg}: read=${ok.length} failed=${results.length - ok.length} props=${props.length} any=${any} unresolved=${[...unresolved].sort().join(',') || '-'}`)
  for (const x of results.filter(x => x.error)) console.log(`${pkg} failed: ${x.file}: ${x.error}`)
}

test('vue-component-meta reads the components of five packages (numbers printed)', () => {
  let calendar
  for (const pkg of ['crouton-calendar', 'crouton-sales', 'crouton-bookings', 'crouton-auth', 'crouton-themes']) {
    const read = readPackage(pkg)
    reportPackage(pkg, read)
    if (pkg === 'crouton-calendar') calendar = read.results.filter(x => x.props)
  }
  assert.equal(calendar.length, 2, `crouton-calendar read ${calendar.length} components, wanted 2`)
  for (const { name, props } of calendar) assert.ok(props.length > 0, `${name} has no non-global props`)
})
