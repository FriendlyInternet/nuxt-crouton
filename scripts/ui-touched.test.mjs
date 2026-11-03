/**
 * #2780 contract — a change is visual only when something on screen can change.
 *
 *   node --test scripts/ui-touched.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { uiTouched, uiTouchedFromFiles, commentLines, underUiKey, isCandidatePath, githubFileDiff } from './ui-touched.mjs'

const none = () => null

// Real hunks from PR #2720 (comment edit in Library.vue, dead key in app.config.ts).
const PR_2720 = `diff --git a/packages/crouton-assets/app/components/Library.vue b/packages/crouton-assets/app/components/Library.vue
--- a/packages/crouton-assets/app/components/Library.vue
+++ b/packages/crouton-assets/app/components/Library.vue
@@ -10 +10 @@ const { getConfig } = useCollections()
-// The package registers a partial 'assets' config (packageForm only, no apiPath),
+// The package registers a partial 'assets' config (no apiPath),
diff --git a/packages/crouton-bookings/CLAUDE.md b/packages/crouton-bookings/CLAUDE.md
--- a/packages/crouton-bookings/CLAUDE.md
+++ b/packages/crouton-bookings/CLAUDE.md
@@ -21 +21 @@
-old
+new
diff --git a/packages/crouton-bookings/app/app.config.ts b/packages/crouton-bookings/app/app.config.ts
--- a/packages/crouton-bookings/app/app.config.ts
+++ b/packages/crouton-bookings/app/app.config.ts
@@ -171,2 +171 @@ export default defineAppConfig({
-    // Package-provided form for locations
-    bookingsLocations: { packageForm: 'X' },
+    bookingsLocations: {},
`

const CONFIG_OLD = [
  'export default defineAppConfig({',
  '  croutonCollections: {',
  '    a: 1,',
  '    // Package-provided form for locations',
  "    bookingsLocations: { packageForm: 'X' },",
  '  },',
  '})'
]

const LIBRARY_VUE = ['<script setup lang="ts">', ...Array(8).fill('const a = 1'), "// The package registers a partial 'assets' config (no apiPath),", '</script>']

test('PR #2720 replays as not visual', () => {
  assert.equal(uiTouched(PR_2720, (_s, p) => (p.endsWith('.vue') ? LIBRARY_VUE : CONFIG_OLD)), 0)
})

test('a template class= change is visual', () => {
  const d = `diff --git a/a/app/components/X.vue b/a/app/components/X.vue
--- a/a/app/components/X.vue
+++ b/a/app/components/X.vue
@@ -3 +3 @@
-  <div class="p-2">
+  <div class="p-4">
`
  assert.equal(uiTouched(d, none), 1)
})

test('a script-only .vue change (mapped to <script>) is not visual (#3228)', () => {
  const d = `diff --git a/x.vue b/x.vue
--- a/x.vue
+++ b/x.vue
@@ -2 +2 @@
-const a = 1
+const a = 2
`
  assert.equal(uiTouched(d, none), 1) // unmappable -> hold
  assert.equal(uiTouched(d, () => ['<script setup>', 'const a = 2', '</script>', '<template><div/></template>']), 0)
})

test('app.config.ts change under ui: is visual; unreadable file holds', () => {
  const lines = ['export default {', '  ui: {', '    button: {', '      x: 1', '    }', '  },', '  other: 1', '}']
  const d = n => `diff --git a/app.config.ts b/app.config.ts
--- a/app.config.ts
+++ b/app.config.ts
@@ -${n} +${n} @@
-x
+y
`
  assert.equal(uiTouched(d(4), () => lines), 1)
  assert.equal(uiTouched(d(7), () => lines), 0)
  assert.equal(uiTouched(d(7), none), 1)
})

// a diff that replaces line `n` of `path` with `line`
const one = (path, n, line) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -${n} +${n} @@
-old
+${line}
`

test('comment/blank classifier (whole-line only)', () => {
  const c = (lines, path = 'x.vue') => commentLines(lines, path)
  assert.deepEqual(c(['<script setup>', '// hi', '</script>']), [false, true, false])
  assert.deepEqual(c(['<template>', '<!-- hi -->', '', '</template>']), [false, true, true, false])
  assert.deepEqual(c(['<script>', '/*', ' * doc line', ' */', '</script>']), [false, true, true, true, false])
  assert.deepEqual(c(['<!--', 'text', '-->']), [true, true, true])
  assert.deepEqual(c(['<div> <!-- x -->']), [false])
  assert.deepEqual(c(['* { margin: 0 }'], 'a.css'), [false])
  assert.deepEqual(c(['// not css'], 'a.css'), [false])
  assert.deepEqual(c(['/* css comment */'], 'a.css'), [true])
  assert.deepEqual(c(['/* c */ .a { color: red }'], 'a.css'), [false])
})

test('<!-- note --><UButton/> is visual', () => {
  const lines = ['<template>', '<!-- note --><UButton/>', '</template>']
  assert.equal(uiTouched(one('x.vue', 2, lines[1]), () => lines), 1)
})

test('a template line `// Total` is visual', () => {
  const lines = ['<template>', '// Total', '</template>']
  assert.equal(uiTouched(one('x.vue', 2, lines[1]), () => lines), 1)
})

test('a // comment inside <script setup> is not visual', () => {
  const lines = ['<script setup>', '// comment', '</script>']
  assert.equal(uiTouched(one('x.vue', 2, lines[1]), () => lines), 0)
})

test('underUiKey walks ancestors', () => {
  assert.ok(underUiKey(['a: {', '  ui: {', '    b: 1', '  }', '}'], 3))
  assert.ok(!underUiKey(['a: {', '  ui: {', '    b: 1', '  },', '  c: 2', '}'], 5))
})

test('#2852: regenerated fixtures/** .vue files are not a visual change', () => {
  const diff = `diff --git a/fixtures/basic/app/components/Form.vue b/fixtures/basic/app/components/Form.vue
--- a/fixtures/basic/app/components/Form.vue
+++ b/fixtures/basic/app/components/Form.vue
@@ -3 +3 @@
-<UButton>a</UButton>
+<UButton>b</UButton>
`
  assert.equal(uiTouched(diff, none), 0)
  assert.equal(uiTouched(diff.replaceAll('fixtures/basic', 'apps/basic'), none), 1)
})

// ---- #3228: uiTouchedFromFiles ----
const SFC = ['<script setup lang="ts">', 'const a = 1', 'const b = 2', '</script>', '<template>', '  <div class="p-2" />', '</template>', '<style>', '.a { color: red }', '</style>']
const file = (filename, patch, extra = {}) => ({ filename, patch, status: 'modified', ...extra })
const reader = (text, seen = []) => (ref) => { seen.push(ref); return text.join('\n') }

test('#3228 script-only .vue (defineModel / ?? hunks) -> 0', async () => {
  const p = '@@ -2 +2 @@\n-const a = defineModel<string>()\n+const a = defineModel<string>({ required: true })\n@@ -3 +3 @@\n-const b = x\n+const b = x ?? \'\''
  assert.equal(await uiTouchedFromFiles([file('a/app/components/Input.vue', p)], reader(SFC)), 0)
})

test('#3228 template / style / css / new / deleted / unreadable -> 1', async () => {
  const tpl = file('x.vue', '@@ -6 +6 @@\n-  <div class="p-2" />\n+  <div class="p-4" />')
  const sty = file('x.vue', '@@ -9 +9 @@\n-.a { color: red }\n+.a { color: blue }')
  assert.equal(await uiTouchedFromFiles([tpl], reader(SFC)), 1)
  assert.equal(await uiTouchedFromFiles([sty], reader(SFC)), 1)
  assert.equal(await uiTouchedFromFiles([file('x.css', '@@ -1 +1 @@\n-a\n+b')], reader(SFC)), 1)
  const scr = '@@ -2 +2 @@\n-const a = 1\n+const a = 2'
  assert.equal(await uiTouchedFromFiles([file('x.vue', scr, { status: 'added' })], reader(SFC)), 1)
  assert.equal(await uiTouchedFromFiles([file('x.vue', scr, { status: 'removed' })], reader(SFC)), 1)
  assert.equal(await uiTouchedFromFiles([file('x.vue', undefined)], reader(SFC)), 1)
  assert.equal(await uiTouchedFromFiles([file('x.vue', scr)], () => { throw new Error('nope') }), 1)
})

test('#3228 script + template mixed -> 1; app.config ui: -> 1', async () => {
  const p = '@@ -2 +2 @@\n-const a = 1\n+const a = 2\n@@ -6 +6 @@\n-x\n+  <div class="p-4" />'
  assert.equal(await uiTouchedFromFiles([file('x.vue', p)], reader(SFC)), 1)
  const cfg = ['export default {', '  ui: {', '    x: 1', '  }', '}']
  assert.equal(await uiTouchedFromFiles([file('app.config.ts', '@@ -3 +3 @@\n-    x: 1\n+    x: 2')], reader(cfg)), 1)
})

test('#3228 -U3 context lines give the same verdict as -U0', async () => {
  const u3 = '@@ -1,5 +1,5 @@\n <script setup lang="ts">\n-const a = 1\n+const a = 2\n const b = 2\n </script>\n <template>'
  assert.equal(await uiTouchedFromFiles([file('x.vue', u3)], reader(SFC)), 0)
})

test('#3228 removed lines are read from the merge-base text, not the tip', async () => {
  // Removed line is old-side line 2. At the merge base it is inside <script>; at the tip the
  // file was reshuffled so line 2 sits inside <template>.
  const mb = ['<script setup>', 'const a = 1', '</script>', '<template>', '<div/>', '</template>']
  const tip = ['<template>', '<div class="old"/>', '</template>', '<script setup>', '</script>']
  const seen = []
  const readText = (ref) => { seen.push(ref); return (ref === 'merge-base' ? mb : tip).join('\n') }
  const p = '@@ -2 +1 @@\n-const a = 1'
  // reading the merge base (correct) -> script -> 0
  assert.equal(await uiTouchedFromFiles([file('x.vue', p)], readText), 0)
  assert.ok(seen.includes('merge-base'))
  // reading the tip (the old bug) -> template -> 1; proves the fixtures tell the two apart
  assert.equal(await uiTouchedFromFiles([file('x.vue', p)], () => tip.join('\n')), 1)
})

test('status.yml passes merge_base_commit as the old-side source', () => {
  const yml = readFileSync(new URL('../.github/workflows/status.yml', import.meta.url), 'utf8')
  assert.match(yml, /merge_base_commit/)
  assert.match(yml, /ref: ref === 'head' \? pr\.head\.sha : mergeBase/)
})

test('#3228 real PR #3216 patches (script-only .vue) replay as not visual', async () => {
  const dir = new URL('./fixtures/ui-touched/', import.meta.url)
  const rd = (n) => readFileSync(new URL(n, dir), 'utf8')
  const files = [
    ['pocs/kvr/app/components/PublicWerkvergunningForm.vue', 'pr3216-components-PublicWerkvergunningForm'],
    ['pocs/kvr/layers/kvr/collections/settings/app/components/Recipient/Input.vue', 'pr3216-Recipient-Input']
  ].map(([filename, base]) => file(filename, rd(`${base}.patch`).trimEnd(), { _base: rd(`${base}.base.txt`) }))
  // head text = merge-base text with the patch's single -/+ line swap applied
  const headOf = (f) => {
    const lines = f._base.split('\n')
    const m = f.patch.match(/^@@ -(\d+)/)
    const minus = f.patch.split('\n').filter(l => l.startsWith('-'))
    const plus = f.patch.split('\n').filter(l => l.startsWith('+'))
    assert.equal(minus.length, 1)
    // hunk starts with 3 context lines before the change
    const at = Number(m[1]) - 1 + f.patch.split('\n').findIndex(l => l.startsWith('-')) - 1
    assert.equal(lines[at], minus[0].slice(1))
    lines[at] = plus[0].slice(1)
    return lines.join('\n')
  }
  const readText = (ref, path) => {
    const f = files.find(x => x.filename === path)
    return ref === 'merge-base' ? f._base : headOf(f)
  }
  assert.equal(await uiTouchedFromFiles(files, readText), 0)
})

test('isCandidatePath: visual and app.config paths yes, fixtures and docs no', () => {
  assert.equal(isCandidatePath('packages/x/app/components/A.vue'), true)
  assert.equal(isCandidatePath('apps/a/app/app.config.ts'), true)
  assert.equal(isCandidatePath('packages/x/CLAUDE.md'), false)
})

test('githubFileDiff: added, removed and renamed entries', () => {
  const added = githubFileDiff({ filename: 'a.vue', status: 'added', patch: '@@ -0,0 +1 @@\n+x' })
  assert.match(added, /--- \/dev\/null\n\+\+\+ b\/a\.vue/)
  const removed = githubFileDiff({ filename: 'a.vue', status: 'removed', patch: '@@ -1 +0,0 @@\n-x' })
  assert.match(removed, /--- a\/a\.vue\n\+\+\+ \/dev\/null/)
  const renamed = githubFileDiff({ filename: 'b.vue', previous_filename: 'a.vue', status: 'renamed', patch: 'P' })
  assert.match(renamed, /^diff --git a\/a\.vue b\/b\.vue\n--- a\/a\.vue\n\+\+\+ b\/b\.vue\nP\n$/)
})

test('#3228 -U3 template change right after </script> is visual; script tag line is visual', async () => {
  const tpl = '@@ -3,5 +3,5 @@\n const b = 2\n </script>\n <template>\n-  <div class="p-2" />\n+  <div class="p-4" />\n </template>\n <style>'
  assert.equal(await uiTouchedFromFiles([file('x.vue', tpl)], reader(SFC)), 1)
  const tag = '@@ -1 +1 @@\n-<script setup>\n+<script setup lang="ts">'
  assert.equal(await uiTouchedFromFiles([file('x.vue', tag)], reader(SFC)), 1)
})
