import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
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
  // Not ConfirmButton: check-doc-claims.deps-test.mjs reads its props and runs in parallel with this
  // file (`node --test scripts/*.deps-test.mjs`), so renaming its prop here made that test flaky.
  expectStaleAfter('packages/crouton-core/app/components/ShortcutHint.vue', 'subtle?: boolean', 'faint?: boolean', /components\.md/)
})

test('composables page lists default-exported composables', () => {
  const page = readPage('composables.md')
  for (const n of ['useCrouton', 'useCroutonError', 'useCroutonRedirects', 'useCollections']) {
    assert.match(page, new RegExp(`^## ${n}$`, 'm'))
  }
})

test('--check fails when a config key is renamed', () => {
  // Not sales' print.enabled: check-doc-claims.deps-test.mjs reads it and runs in parallel with this file.
  expectStaleAfter('packages/crouton-maps/crouton.manifest.ts', `'geocodingUrl': {`, `'geocodingEndpoint': {`, /config-keys\.md/)
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
  assert.match(r.stdout, /^\d+ components named, 0 without a file, 0 used outside and not named$/m)
})

// ── used outside its package but not named (#3909) ─────────────────────────────────────────────
test('--check fails on a component used outside its package but not named', () => {
  // CroutonCalendarWeek is used by tag in crouton-bookings Calendar.vue.
  const r = mutateAndRun('packages/crouton-calendar/crouton.manifest.ts', "name: 'CroutonCalendarWeek'", "name: 'CroutonCalendarMonth'", () => names('--check'))
  expectStatus(r, 1)
  assert.match(r.stderr, /crouton-calendar: CroutonCalendarWeek is used outside the package, not named in the manifest/)
})

test("--check counts resolveComponent('Name') as a use", () => {
  // TeamSwitcher's only outside use is resolveComponent('TeamSwitcher') in crouton-core AdminSidebar.vue.
  const r = mutateAndRun('packages/crouton-auth/crouton.manifest.ts', "name: 'TeamSwitcher'", "name: 'TeamSettings'", () => names('--check'))
  expectStatus(r, 1)
  assert.match(r.stderr, /crouton-auth: TeamSwitcher is used outside the package, not named in the manifest/)
})

test('a TypeScript generic is not a tag use (TeamThemeSettings stays unnamed)', () => {
  // `$type<TeamThemeSettings>()` in crouton-auth must not count as a use of crouton-admin's component.
  const r = names('--check')
  expectStatus(r, 0)
  assert.ok(!readFileSync('packages/crouton-admin/crouton.manifest.ts', 'utf8').includes("name: 'TeamThemeSettings'"))
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

// ── per-package component pages (#3933): packages/<pkg>/docs/components.md matches the code; packages/<pkg>/docs/llms.txt matches the manifest (#3980) ────
// After the component-names tests, so every .nuxt/components.d.ts already exists.
const pkgDocs = (...args) => spawnSync('node', ['scripts/gen-package-docs.mjs', ...args], { encoding: 'utf8' })

// covers: T1
test('gen-package-docs --check passes on the clean tree', () => {
  const r = pkgDocs('--check')
  expectStatus(r, 0)
  assert.match(r.stdout, /^\d+ package pages and \d+ index files up to date$/m)
})

// covers: T2
test('crouton-calendar page lists Week props, events and slots', () => {
  const lines = readFileSync('packages/crouton-calendar/docs/components.md', 'utf8').split('\n')
  for (const want of [
    '| `variant` | `"default" \\| "beams" \\| "bars"` | `"default"` | no |  |',
    '| `select` | `[value: Date \\| null]` |',
    '| `day-action` | `{ day: any; jsDate: any; weekday: any; dayNumber: any; }` |',
    '| `date` | `Date` | - | yes |  |'
  ]) assert.ok(lines.includes(want), `missing line: ${want}`)
})

// covers: T3
test('gen-package-docs --check fails when a named component prop type changes', () => {
  const r = mutateAndRun('packages/crouton-calendar/app/components/Week.vue', "variant?: 'default' | 'beams' | 'bars'", "variant?: 'default' | 'beams' | 'bars' | 'dots'", () => pkgDocs('--check'))
  expectStatus(r, 1)
  assert.match(r.stderr, /stale: packages\/crouton-calendar\/docs\/components\.md/)
})

// covers: T4
test('crouton-calendar llms.txt is exactly the manifest index', () => {
  const want = [
    '<!-- Generated by scripts/gen-package-docs.mjs from this package\'s manifest. Do not edit. -->',
    '# @fyit/crouton-calendar',
    '',
    '> Swipeable week/month calendar views',
    '',
    'AI hint: use when app needs a week/month calendar view of dated items',
    '',
    '## Components',
    '',
    '- `CroutonCalendarMonth`: Swipeable month grid with a fixed header and weekday row',
    '- `CroutonCalendarWeek`: Swipeable week strip (prev · current · next) with a #day slot and a #day-action slot',
    '',
    'Props, events and slots: [components.md](components.md)',
    ''
  ].join('\n')
  assert.equal(readFileSync('packages/crouton-calendar/docs/llms.txt', 'utf8'), want)
})

// covers: T5
test('gen-package-docs --check fails when a manifest description changes', () => {
  const r = mutateAndRun('packages/crouton-calendar/crouton.manifest.ts', "description: 'Swipeable week/month calendar views'", "description: 'Swipeable week/month calendar views.'", () => pkgDocs('--check'))
  expectStatus(r, 1)
  assert.match(r.stderr, /stale: packages\/crouton-calendar\/docs\/llms\.txt/)
})

// covers: T6
test('every package with a manifest ships docs/llms.txt and its components.md', () => {
  const pkgs = readdirSync('packages').filter(p => existsSync(`packages/${p}/crouton.manifest.ts`))
  assert.ok(pkgs.length > 0)
  for (const p of pkgs) {
    const files = JSON.parse(readFileSync(`packages/${p}/package.json`, 'utf8')).files ?? []
    assert.ok(files.includes('docs/llms.txt'), `${p}: files lacks docs/llms.txt`)
    assert.equal(files.includes('docs/components.md'), existsSync(`packages/${p}/docs/components.md`), `${p}: files and docs/components.md disagree`)
  }
})

// ---------- doc-mentions (#4053) — these tests edit no tracked file ----------
const docMentions = () => import('./doc-mentions.mjs')
const mentionsCli = (...args) => spawnSync('node', ['scripts/doc-mentions.mjs', ...args], { encoding: 'utf8' })

// covers: T1
test('doc-mentions namesOf reads component/composable headings and dotted or capitalised config keys', async () => {
  const { namesOf } = await docMentions()
  const names = namesOf({
    'components.md': '# Components\n\n## CroutonTable\n\n| Prop | Type |\n| --- | --- |\n| `page` | `number` |\n\n## Components without props\n\n- `CroutonForm`\n- `CroutonLoading`\n',
    'composables.md': '# Composables\n\n## useCollectionExport\n\n## Something else\n',
    'config-keys.md': '## crouton-sales\n\n| Key | Type |\n| --- | --- |\n| `print.enabled` | `boolean` |\n| `bookingModes` | `string[]` |\n| `style` | `string` |\n'
  })
  for (const n of ['CroutonTable', 'CroutonForm', 'CroutonLoading', 'useCollectionExport', 'print.enabled', 'bookingModes']) assert.ok(names.has(n), `missing ${n}`)
  for (const n of ['page', 'style', 'Components without props', 'Components', 'Something else', 'crouton-sales', 'Key']) assert.ok(!names.has(n), `should not include ${n}`)
})

// covers: T1
test('doc-mentions goneNames: a moved name and a name still registered elsewhere are not gone', async () => {
  const { namesOf, goneNames } = await docMentions()
  const { registeredComponentsOf } = await import('./gen-api-reference.mjs')
  const existing = registeredComponentsOf()
  assert.ok(existing.has('CroutonEditorSimple'))
  const base = namesOf({ 'components.md': '## CroutonEditorSimple\n\n## CroutonReallyGone\n\n## Components without props\n\n- `CroutonShift`\n' })
  // CroutonShift moved from components.md to composables.md (a heading there, under one name set across pages)
  const now = namesOf({ 'components.md': '## CroutonOther\n', 'composables.md': '## useX\n' })
  now.add('CroutonShift')
  assert.deepEqual(goneNames(base, now, existing), ['CroutonReallyGone'])
  const movedBase = namesOf({ 'components.md': '## Components without props\n\n- `useMovedThing`\n' })
  const movedNow = namesOf({ 'composables.md': '## useMovedThing\n' })
  assert.ok(movedBase.has('useMovedThing') && movedNow.has('useMovedThing'))
  assert.deepEqual(goneNames(movedBase, movedNow, new Set()), [])
})

// covers: T1
test('doc-mentions mentions matches whole names only, on the real crouton-core notes too', async () => {
  const { mentions } = await docMentions()
  const file = 'packages/crouton-core/CLAUDE.md'
  const hits = mentions(new Set(['useCollectionExport']), [{ file, text: readFileSync(file, 'utf8') }])
  assert.ok(hits.length >= 1, 'expected a hit in crouton-core notes')
  for (const h of hits) { assert.equal(h.file, file); assert.ok(h.text.includes('useCollectionExport')); assert.ok(h.line >= 1) }
  const doc = [{ file: 'x.md', text: 'useCollectionExport()\nuse useCollection-x here\n```\nconst a = useCollection()\n```\ncroutonSales.print.enabled: true\nprintXenabled\n' }]
  assert.deepEqual(mentions(new Set(['useCollection']), doc).map(h => h.line), [4])
  assert.deepEqual(mentions(new Set(['print.enabled']), doc).map(h => h.line), [6])
})

// covers: T2
test('doc-mentions CLI reports a name gone since a throwaway base commit', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const git = (args, opts = {}) => {
    const r = spawnSync('git', args, { encoding: 'utf8', ...opts })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const dir = mkdtempSync(join(tmpdir(), 'doc-mentions-'))
  try {
    const page = 'docs/content/8.api-reference/composables.md'
    const blob = git(['hash-object', '-w', '--stdin'], { input: readFileSync(page, 'utf8').trimEnd() + '\n\n## useNoSuchComposableXyz\n' })
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
    git(['read-tree', 'HEAD'], { env })
    git(['update-index', '--cacheinfo', `100644,${blob},${page}`], { env })
    const tree = git(['write-tree'], { env })
    const sha = git(['commit-tree', tree, '-p', 'HEAD', '-m', 'throwaway doc-mentions base'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
    })
    const r = mentionsCli('--base', sha)
    expectStatus(r, 0)
    assert.match(r.stdout, /doc-mentions: gone: useNoSuchComposableXyz/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// covers: T2
test('doc-mentions CLI --base HEAD prints none', () => {
  const r = mentionsCli('--base', 'HEAD')
  expectStatus(r, 0)
  assert.match(r.stdout, /doc-mentions: none/)
})

// covers: T2
test('doc-mentions CLI exits 2 on a bad base without printing none', () => {
  const r = mentionsCli('--base', 'no-such-ref-xyz')
  expectStatus(r, 2)
  assert.doesNotMatch(r.stdout + r.stderr, /none/)
  const noFlag = mentionsCli()
  expectStatus(noFlag, 2)
  assert.doesNotMatch(noFlag.stdout + noFlag.stderr, /none/)
})
