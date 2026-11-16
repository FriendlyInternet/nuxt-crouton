// Needs `typescript` + `vue-component-meta` (via scripts/gen-api-reference.mjs), so it runs in the
// "Build packages" job that installs packages, not in the bare-Node set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'check-doc-claims.mjs')
const run = (md, ...flags) => {
  const dir = mkdtempSync(join(tmpdir(), 'docclaims-'))
  writeFileSync(join(dir, 'page.md'), md)
  return spawnSync('node', [script, ...flags, dir], { encoding: 'utf8' })
}

test('unknown CLI command is reported with page and line, strict exits 1', () => {
  const r = run('# T\n\nRun `npx crouton frobnicate` now\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /page\.md:3 .*crouton frobnicate/)
})

test('real CLI command passes', () => {
  const r = run('Run `npx crouton config` now\n', '--strict')
  assert.equal(r.status, 0, r.stdout)
})

test('unknown CLI flag is reported; real flags, aliases and --no-<boolean> pass', () => {
  const bad = run('```bash\nnpx crouton rollback shop products --bogus-flag\n```\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:2 .*`crouton rollback` has no flag `--bogus-flag`/)
  const good = run('```bash\nnpx crouton rollback shop products --dry-run --keep-files\nnpx crouton generate shop products -f x.json --no-db --no-hierarchy --help\n```\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
})

test('schema block with unknown field type is reported', () => {
  const r = run('x\n\n```json\n{ "title": { "type": "nonsense" } }\n```\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /unknown type "nonsense"/)
})

test('valid schema block passes; skip marker is honoured', () => {
  assert.equal(run('```json\n{ "title": { "type": "string" } }\n```\n', '--strict').status, 0)
  assert.equal(run('<!-- doc-check: skip -->\n```json\n{ "t": { "type": "nonsense" } }\n```\n', '--strict').status, 0)
})

test('field type aliases from the manifests pass', () => {
  assert.equal(run('```json\n{ "n": { "type": "integer" }, "d": { "type": "datetime" } }\n```\n', '--strict').status, 0)
})

test('ts block with a syntax error is reported; fragments are skipped', () => {
  assert.equal(run('```ts\nconst = ;\n```\n', '--strict').status, 1)
  assert.equal(run('```ts\nconst = ...\n```\n', '--strict').status, 0)
})

test('could not run is a failure: without typescript installed the checker exits non-zero', () => {
  // A copy of the scripts outside the repo cannot resolve `typescript` — exactly the bare-job shape.
  const dir = join(mkdtempSync(join(tmpdir(), 'docclaims-nodeps-')), 'scripts')
  mkdirSync(dir)
  for (const f of ['check-doc-claims.mjs', 'gen-api-reference.mjs']) copyFileSync(join(here, f), join(dir, f))
  const docs = mkdtempSync(join(tmpdir(), 'docclaims-'))
  writeFileSync(join(docs, 'page.md'), '# nothing wrong here\n')
  const r = spawnSync('node', [join(dir, 'check-doc-claims.mjs'), docs], { encoding: 'utf8' })
  assert.notEqual(r.status, 0, r.stdout)
  assert.doesNotMatch(r.stdout, /Total: 0/)
})

test('report-only by default (exit 0 with findings)', () => {
  assert.equal(run('`npx crouton frobnicate`\n').status, 0)
})

test('a misspelled non-Crouton composable fails with page and line; package, Nuxt and VueUse ones pass', () => {
  const bad = run('# T\n\n```ts\nconst { items } = useCollectionQuerry(\'posts\')\n```\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:4 .*composable `useCollectionQuerry`/)
  const good = run('```ts\nconst { items } = useCollectionQuery(\'posts\')\nconst { data } = useFetch(\'/api/x\')\nconst v = useLocalStorage(\'k\', 1)\nconst toast = useToast()\nconst r = useRoute()\nconst s = useSlots()\n```\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
})

test('a composable the page defines itself is not reported', () => {
  assert.equal(run('```ts\nexport function useMyThing() { return 1 }\nconst x = useMyThing()\n```\n', '--strict').status, 0)
})

test('missing component / composable is reported with page and line; real ones pass', () => {
  const r = run('# T\n\nUse <CroutonDoesNotExistXyz /> here\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /page\.md:3 .*CroutonDoesNotExistXyz/)
  assert.equal(run('Call useCroutonNopeXyz() now\n', '--strict').status, 1)
  assert.equal(run('Call useCrouton() or <CroutonFormLayout /> now\n', '--strict').status, 0)
})

test('a component named without its package prefix is reported with page and line; the prefixed name passes', () => {
  // Button.vue exists in other packages' dirs, but no package registers it as CroutonButton
  const bad = run('# T\n\nUse <CroutonButton label="x" />\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:3 .*component `CroutonButton` is not a registered component name/)
  for (const n of ['CroutonCard', 'CroutonMap', 'CroutonList']) assert.match(run(`<${n} />\n`).stdout, new RegExp(`component \`${n}\``))
  const good = run('<CroutonMapsMap /> and <CroutonI18nDisplay /> and <UButton />\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
})

test('a Crouton… word only in a code comment of a package does not make a component name found', (t) => {
  // A throwaway package next to the real ones: its nuxt.config registers Widget.vue as CroutonFixtureWidget,
  // and Widget.vue mentions CroutonCommentOnlyXyz only in comments.
  const pkg = join(here, '..', 'packages', `zz-doc-claims-fixture-${process.pid}`)
  mkdirSync(join(pkg, 'app/components'), { recursive: true })
  t.after(() => rmSync(pkg, { recursive: true, force: true }))
  writeFileSync(join(pkg, 'nuxt.config.ts'), `import { join } from 'node:path'\nconst currentDir = '.'\nexport default defineNuxtConfig({ components: { dirs: [{ path: join(currentDir, 'app/components'), prefix: 'CroutonFixture' }] } })\n`)
  writeFileSync(join(pkg, 'app/components/Widget.vue'), '<script setup lang="ts">\n// renders like <CroutonCommentOnlyXyz>\n/* CroutonCommentOnlyXyz */\n</script>\n<template><!-- CroutonCommentOnlyXyz --><div /></template>\n')
  assert.equal(run('<CroutonFixtureWidget />\n', '--strict').status, 0)
  const r = run('# T\n\n<CroutonCommentOnlyXyz />\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /page\.md:3 .*component `CroutonCommentOnlyXyz` is not a registered component name/)
})

test('made-up config key is reported with page and line; real keys and prefixes pass', () => {
  const bad = run('# T\n\nSet `croutonBookings.email.enabeld: true`\n\nand `features.maps.madeUpKey`\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:3 .*config key `croutonBookings\.email\.enabeld` not in crouton-bookings/)
  assert.match(bad.stdout, /page\.md:5 .*config key `features\.maps\.madeUpKey` not in crouton-maps/)
  const good = run('Set `croutonBookings.email.enabled: true`, `croutonBookings.email`, `runtimeConfig.public.maps.style` and `config.features.sales.print.enabled`\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
})

test('unknown prop on a crouton-core component is reported; real props, events, slots and class pass', () => {
  const bad = run('```vue\n<CroutonConfirmButton\n  :confirm-text="x"\n/>\n```\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:3 .*<CroutonConfirmButton>` has no prop `confirmText`/)
  const good = run('```vue\n<CroutonConfirmButton :confirm-label="x" class="a" @confirm="go" <!-- note --> />\n```\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
})
