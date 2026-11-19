// Tests for scripts/check-runtime-cost.mjs (#3910, part 2 #3936: cases T1-T7). Runs in the "Run scripts/*.deps-test.mjs"
// step because it needs @vue/compiler-sfc. The 9 ticket cases go through the real CLI in a
// temp git repo (base commit → origin/main, head commit), plus a few countHits unit checks.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { countHits, compare, parseNameStatus, checkChanged, summarize, formatRegression, GENERATED_HINT } from './check-runtime-cost.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-runtime-cost.mjs')
const dirs = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const C = 'packages/x/app/components'
const sfc = body => `<template>\n  <div>\n${body}\n  </div>\n</template>\n`

/**
 * Build a repo: `base` files committed and pointed to by origin/main; then `mutate(dir)`
 * (write/rename/delete) committed as head. Returns { status, stdout } of the CLI.
 */
function runCase({ base = {}, head = {}, renames = [], remove = [], args = ['--base-ref', 'main'], env } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-cost-'))
  dirs.push(dir)
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  const put = (f, s) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
  put('README.md', 'x')
  for (const [f, s] of Object.entries(base)) put(f, s)
  git('add', '-A'); git('commit', '-qm', 'base')
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'))
  for (const [from, to] of renames) { mkdirSync(dirname(join(dir, to)), { recursive: true }); renameSync(join(dir, from), join(dir, to)) }
  for (const f of remove) unlinkSync(join(dir, f))
  for (const [f, s] of Object.entries(head)) put(f, s)
  git('add', '-A'); git('commit', '-qm', 'head', '--allow-empty')
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout) + String(e.stderr) }
  }
}

const POPOVER_LOOP = sfc('    <UPopover v-for="i in items" :key="i"><span>{{ i }}</span></UPopover>')

test('1 · a new file with a UPopover in a v-for fails with file, count and line', () => {
  const r = runCase({ head: { [`${C}/New.vue`]: POPOVER_LOOP } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /New\.vue: A 0 → 1/)
  assert.match(r.stdout, /New\.vue:3 UPopover under v-for@3/)
})

test('2 · renaming a file with an existing hit passes', () => {
  const r = runCase({ base: { [`${C}/Old.vue`]: POPOVER_LOOP }, renames: [[`${C}/Old.vue`, `${C}/Renamed.vue`]] })
  assert.equal(r.status, 0, r.stdout)
})

test('3 · the allow comment excuses a hit only with a reason', () => {
  const ok = sfc('    <!-- runtime-cost-ok: capped at 5 avatars -->\n    <UTooltip v-for="a in avatars" :key="a" text="x"><span /></UTooltip>')
  const r = runCase({ head: { [`${C}/Avatars.vue`]: ok } })
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /allowed=1/)

  const prod = runCase({ head: { [`${C}/Avatars.vue`]: ok }, env: { ...process.env, NODE_ENV: 'production' } })
  assert.equal(prod.status, 0, prod.stdout)
  assert.match(prod.stdout, /allowed=1/)

  const bare = sfc('    <!-- runtime-cost-ok: -->\n    <UTooltip v-for="a in avatars" :key="a" text="x"><span /></UTooltip>')
  const r2 = runCase({ head: { [`${C}/Avatars.vue`]: bare } })
  assert.equal(r2.status, 1, r2.stdout)
})

test('4 · a per-item slot counts as a loop; a header slot does not', () => {
  const cell = s => `<template>\n  <UTable :data="rows">\n    <template ${s}>\n      <UDropdownMenu :items="[]"><UButton /></UDropdownMenu>\n    </template>\n  </UTable>\n</template>\n`
  const r = runCase({ head: { [`${C}/T.vue`]: cell('#actions-cell="{ row }"') } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /T\.vue:4 UDropdownMenu under #actions-cell@3/)
  assert.equal(runCase({ head: { [`${C}/T.vue`]: cell('#header') } }).status, 0)
})

test('5 · hover-only classes and hover popovers', () => {
  const el = cls => sfc(`    <button class="${cls}">x</button>`)
  const cases = [
    [el('opacity-0 group-hover:opacity-100'), 1],
    [el('opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100'), 0],
    [el('opacity-0 group-hover:opacity-100 pointer-coarse:ps-9'), 1],
    [el('opacity-0 group-hover/pane:opacity-100'), 1],
    [el('hidden md:flex hover:bg-muted'), 0],
    [sfc('    <UPopover mode="hover"><span /></UPopover>'), 1],
    [sfc('    <UPopover mode="hover" enable-touch><span /></UPopover>'), 0],
  ]
  for (const [src, want] of cases) {
    const r = runCase({ head: { [`${C}/B.vue`]: src } })
    assert.equal(r.status, want, `${src}\n${r.stdout}`)
    if (want) assert.match(r.stdout, /B\.vue: B 0 → 1/)
  }
})

test('6 · removing a hit passes', () => {
  const r = runCase({ base: { [`${C}/Gone.vue`]: POPOVER_LOOP }, head: { [`${C}/Gone.vue`]: sfc('    <span />') } })
  assert.equal(r.status, 0, r.stdout)
})

// covers: T8
test('7 · without --base-ref it prints totals and exits 0', () => {
  const r = runCase({ head: { [`${C}/New.vue`]: POPOVER_LOOP }, args: [] })
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /^\[runtime-cost\] files=\d+ A=\d+ B=\d+ C=\d+ D=\d+ E=\d+ allowed=\d+ unparsable=\d+$/m)
  assert.match(r.stdout, /files=1 A=1 B=0/)
})

test('8 · unparsable at head fails; broken at base and fixed in head warns', () => {
  const broken = '<template>\n  <div>\n    <span>\n  </div>\n</template>\n'
  const r = runCase({ head: { [`${C}/Broken.vue`]: broken } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /Broken\.vue/)

  const r2 = runCase({ base: { [`${C}/Broken.vue`]: broken }, head: { [`${C}/Broken.vue`]: POPOVER_LOOP } })
  assert.equal(r2.status, 0, r2.stdout)
  assert.match(r2.stdout, /warning: .*Broken\.vue/)
})

test('9 · moving a hit into another file fails for that file', () => {
  const r = runCase({
    base: { [`${C}/a.vue`]: POPOVER_LOOP, [`${C}/b.vue`]: sfc('    <span />') },
    head: { [`${C}/a.vue`]: sfc('    <span />'), [`${C}/b.vue`]: POPOVER_LOOP },
  })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /b\.vue: A 0 → 1/)
  assert.doesNotMatch(r.stdout, /a\.vue: A/)
})

test('countHits · an overlay under a v-for ancestor is a hit, outside it is not', () => {
  const src = sfc('    <ul>\n      <li v-for="i in items" :key="i">\n        <p><UTooltip text="t"><span /></UTooltip></p>\n      </li>\n    </ul>\n    <UModal />')
  const c = countHits(src, parse)
  assert.equal(c.A.length, 1)
  assert.deepEqual(c.A[0], { line: 5, tag: 'UTooltip', under: 'v-for@4' })
})

test('countHits · at most one B hit per element', () => {
  const c = countHits(sfc('    <UPopover mode="hover" class="opacity-0 hover:opacity-100 invisible hover:visible"><span /></UPopover>'), parse)
  assert.equal(c.B.length, 1)
})

// covers: T8
test('countHits · a file without a template has no hits', () => {
  assert.deepEqual(countHits('<script setup>\nconst a = 1\n</script>\n', parse), { A: [], B: [], C: [], D: [], E: [], allowed: 0, unparsable: false })
})

test('parseNameStatus · keeps A/M/R .vue under the three roots, by new path', () => {
  const raw = ['A', 'packages/a/N.vue', 'M', 'apps/b/M.vue', 'R087', 'pocs/o.vue', 'packages/x/n.vue',
    'D', 'packages/d.vue', 'C100', 'packages/c.vue', 'packages/c2.vue', 'M', 'docs/x.vue', 'M', 'packages/x.ts', ''].join('\0')
  assert.deepEqual(parseNameStatus(raw), [
    { path: 'packages/a/N.vue', old: null },
    { path: 'apps/b/M.vue', old: 'apps/b/M.vue' },
    { path: 'packages/x/n.vue', old: 'pocs/o.vue' },
    { path: 'packages/c2.vue', old: null },
  ])
})

test('checkChanged · failure, warning and rename paths in process', () => {
  const broken = '<template>\n  <div>\n    <span>\n  </div>\n</template>\n'
  const head = { 'n.vue': countHits(POPOVER_LOOP, parse), 'bad.vue': countHits(broken, parse), 'fixed.vue': countHits(POPOVER_LOOP, parse) }
  const bases = { 'old.vue': POPOVER_LOOP, 'fixed.vue': broken }
  const changed = [{ path: 'n.vue', old: 'old.vue' }, { path: 'bad.vue', old: null }, { path: 'fixed.vue', old: 'fixed.vue' }, { path: 'gone.vue', old: null }]
  const r = checkChanged(changed, head, old => bases[old] ?? null, parse)
  assert.deepEqual(r.failures, ['bad.vue: does not parse — fix the template so it can be checked'])
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /fixed\.vue/)
  const t = summarize(head)
  assert.deepEqual([t.A, t.B, t.allowed, t.unparsable], [2, 0, 0, ['bad.vue']])
})

// covers: T8
test('formatRegression · B lines and the generated-file note', () => {
  const lines = formatRegression({ file: 'g.vue', kind: 'B', base: 0, head: 1, hits: [{ line: 3, tag: 'button', why: 'opacity-0 revealed only by hover:opacity-100' }] }, '<!-- @crouton-generated -->\n')
  assert.equal(lines[0], 'g.vue: B 0 → 1')
  assert.equal(lines[1], '  all B hits now in this file:')
  assert.match(lines[2], /g\.vue:3 button opacity-0/)
  assert.match(lines[3], /pointer-coarse/)
  assert.equal(lines[4], `  ${GENERATED_HINT}`)
})

// covers: T8
test('compare · rename maps to the old base count; a missing base is 0', () => {
  const one = { A: [{ line: 1, tag: 'UPopover', under: 'v-for@1' }], B: [], C: [], D: [], E: [] }
  const none = { A: [], B: [], C: [], D: [], E: [] }
  assert.deepEqual(compare({ 'old.vue': one }, { 'new.vue': one }, { 'new.vue': 'old.vue' }), [])
  assert.equal(compare({}, { 'n.vue': one })[0].base, 0)
  assert.deepEqual(compare({ 'a.vue': one }, { 'a.vue': none }), [])
})

// ── part 2 (#3936): C heavy per item, D rebuilding key, E composable in template ──

const ALLOW = '    <!-- runtime-cost-ok: shown once in a static page -->\n'

// covers: T1
test('T1 · C: a heavy component per item', () => {
  const r = runCase({ head: { [`${C}/New.vue`]: sfc('    <CroutonEditorPreview v-for="i in items" :key="i" />') } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /New\.vue: C 0 → 1/)
  assert.match(r.stdout, /New\.vue:\d+ CroutonEditorPreview under v-for@\d+/)

  const cell = `<template>\n  <UTable :data="rows">\n    <template #notes-cell="{ row }">\n      <CroutonEditorPreview :content="row.notes" />\n    </template>\n  </UTable>\n</template>\n`
  assert.equal(runCase({ head: { [`${C}/Cell.vue`]: cell } }).status, 1)
  assert.equal(runCase({ head: { [`${C}/Lazy.vue`]: sfc('    <LazyCroutonChartsWidget v-for="i in items" :key="i" />') } }).status, 1)

  const once = runCase({ head: { [`${C}/Once.vue`]: sfc('    <CroutonEditorPreview />') } })
  assert.equal(once.status, 0, once.stdout)
  assert.match(once.stdout, / C=0 /)

  const ok = runCase({ head: { [`${C}/Ok.vue`]: sfc(`${ALLOW}    <CroutonEditorPreview v-for="i in items" :key="i" />`) } })
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /allowed=1/)
})

// covers: T2
test('T2 · D: a key that rebuilds a block', () => {
  const r = runCase({ head: { [`${C}/K.vue`]: sfc('    <div :key="tick"><span /></div>') } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /K\.vue: D 0 → 1/)
  assert.match(r.stdout, /:key="tick"/)
  assert.equal(runCase({ head: { [`${C}/K.vue`]: sfc('    <component :is="c" :key="tick" />') } }).status, 1)

  for (const body of [
    '    <ul><li v-for="i in items" :key="i.id" /></ul>',
    '    <ul><template v-for="i in items"><li :key="i.id" /></template></ul>',
    '    <Transition><div :key="step" /></Transition>',
  ]) {
    const ok = runCase({ head: { [`${C}/K.vue`]: sfc(body) } })
    assert.equal(ok.status, 0, `${body}\n${ok.stdout}`)
    assert.match(ok.stdout, / D=0 /)
  }

  const allowed = runCase({ head: { [`${C}/K.vue`]: sfc(`${ALLOW}    <div :key="tick"><span /></div>`) } })
  assert.equal(allowed.status, 0, allowed.stdout)
  assert.match(allowed.stdout, /allowed=1/)
})

// covers: T3
test('T3 · E: a composable called from the template', () => {
  const r = runCase({ head: { [`${C}/E.vue`]: sfc('    <span>{{ useTimeAgo(d).value }}</span>') } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /E\.vue: E 0 → 1/)
  assert.match(r.stdout, /useTimeAgo\(\)/)
  assert.equal(runCase({ head: { [`${C}/E.vue`]: sfc(`    <span :title="useFormat().label('x')" />`) } }).status, 1)

  for (const body of ['    <button @click="useExample(x)">x</button>', '    <span>{{ reuseThing(x) }}</span>', '    <span>{{ user.name }}</span>']) {
    const ok = runCase({ head: { [`${C}/E.vue`]: sfc(body) } })
    assert.equal(ok.status, 0, `${body}\n${ok.stdout}`)
    assert.match(ok.stdout, / E=0 /)
  }

  const parent = runCase({ head: { [`${C}/E.vue`]: sfc(`${ALLOW}    <span>{{ useTimeAgo(d).value }}</span>`) } })
  assert.equal(parent.status, 0, parent.stdout)
  assert.match(parent.stdout, /allowed=1/)

  const root = '<template>\n  <!-- runtime-cost-ok: shown once in a static page -->\n  {{ useX() }}\n</template>\n'
  const top = runCase({ head: { [`${C}/Root.vue`]: root } })
  assert.equal(top.status, 0, top.stdout)
  assert.match(top.stdout, /allowed=1/)
})

// covers: T4
test('T4 · :enable-touch="false" counts as no enable-touch', () => {
  const pop = attr => sfc(`    <UPopover mode="hover" ${attr}><span /></UPopover>`)
  assert.equal(runCase({ head: { [`${C}/P.vue`]: pop(':enable-touch="false"') } }).status, 1)
  assert.equal(runCase({ head: { [`${C}/P.vue`]: pop(':enable-touch="isTouch"') } }).status, 0)
  assert.equal(runCase({ head: { [`${C}/P.vue`]: pop('enable-touch') } }).status, 0)
})

// covers: T5
test('T5 · a failure lists all hits of the kind under a label', () => {
  const tips = n => sfc(Array.from({ length: n }, (_, k) => `    <UTooltip v-for="a in l${k}" :key="a" text="x"><span /></UTooltip>`).join('\n'))
  const r = runCase({ base: { [`${C}/Tips.vue`]: tips(2) }, head: { [`${C}/Tips.vue`]: tips(3) } })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /Tips\.vue: A 2 → 3\n {2}all A hits now in this file:\n(?: {2}\S+Tips\.vue:\d+ UTooltip under v-for@\d+\n){3}/)
})

// covers: T6
test('T6 · the totals line carries all five kinds', () => {
  const r = runCase({ head: { [`${C}/New.vue`]: POPOVER_LOOP }, args: [] })
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /^\[runtime-cost\] files=\d+ A=\d+ B=\d+ C=\d+ D=\d+ E=\d+ allowed=\d+ unparsable=\d+$/m)
})

// covers: T7
test('T7 · C going down while D goes up names only D', () => {
  const r = runCase({
    base: { [`${C}/Swap.vue`]: sfc('    <CroutonMapsPreview v-for="i in items" :key="i" />') },
    head: { [`${C}/Swap.vue`]: sfc('    <CroutonMapsPreview :key="tick" />') },
  })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /: D 0 → 1/)
  assert.doesNotMatch(r.stdout, /: C /)
})
