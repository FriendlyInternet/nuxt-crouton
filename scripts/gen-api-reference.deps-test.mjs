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
