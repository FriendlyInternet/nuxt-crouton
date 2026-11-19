// T6 (#4071): the REAL ESLint with eslint.frontend-gate.config.mjs, then its JSON through the gate CLI.
// Needs `eslint`, `eslint-plugin-vue` and `@typescript-eslint/parser`, so it runs in the
// "Build packages" job that installs packages, not in the bare-Node set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ESLint } from 'eslint'

const config = fileURLToPath(new URL('../eslint.frontend-gate.config.mjs', import.meta.url))
const script = fileURLToPath(new URL('./frontend-gate.mjs', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'frontend-gate-deps-'))
const REL = 'app/components/Row.vue'
mkdirSync(join(root, 'app/components'), { recursive: true })

const BUTTON = [
  '<script setup lang="ts">',
  'const n: number = 1',
  '</script>',
  '',
  '<template>',
  '  <div>',
  '    <button',
  '      type="button"',
  '      @click="n++"',
  '    >',
  '      {{ n }}',
  '    </button>',
  '  </div>',
  '</template>',
  ''
].join('\n')
const UBUTTON = '<script setup lang="ts">\nconst n: number = 1\n</script>\n\n<template>\n  <UButton :label="String(n)" />\n</template>\n'
const DISABLED = '<template>\n  <div>\n    <!-- eslint-disable-next-line vue/no-restricted-html-elements -- native file picker -->\n    <input type="file">\n  </div>\n</template>\n'

const eslint = new ESLint({ cwd: root, overrideConfigFile: config })
async function lint(name, source) {
  const p = join(root, name)
  writeFileSync(p, source)
  const [r] = await eslint.lintFiles([p])
  return r
}

test('T6 multi-line <button in <script setup lang="ts"> → one message on the tag line, no fatal', async () => {
  const r = await lint(REL, BUTTON)
  assert.equal(r.messages.filter(m => m.fatal).length, 0, JSON.stringify(r.messages))
  const hits = r.messages.filter(m => m.ruleId === 'vue/no-restricted-html-elements')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 7)
})

test('T6 <UButton> → no message', async () => {
  const r = await lint('app/components/Ok.vue', UBUTTON)
  assert.deepEqual(r.messages, [])
})

test('T6 <input type="file"> under the eslint-disable-next-line comment → no message', async () => {
  const r = await lint('app/components/Picker.vue', DISABLED)
  assert.deepEqual(r.messages, [])
})

test('T6 the real ESLint JSON through the CLI with a matching diff → exit 1 naming file:line', async () => {
  const r = await lint(REL, BUTTON)
  const eslintJson = join(root, 'eslint-frontend.json')
  writeFileSync(eslintJson, JSON.stringify([r]))
  const lines = BUTTON.split('\n').slice(0, -1)
  const diff = [
    `diff --git a/${REL} b/${REL}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${REL}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(l => `+${l}`),
    ''
  ].join('\n')
  const diffFile = join(root, 'pr.diff')
  writeFileSync(diffFile, diff)
  const verdict = join(root, 'verdict.json')
  writeFileSync(verdict, JSON.stringify({ highest: 'none', critical: 0, warning: 0, note: 0, findings: [] }))
  const res = spawnSync('node', [script, '--diff', diffFile, '--eslint', eslintJson, '--verdict', verdict, '--root', root], { encoding: 'utf8' })
  assert.equal(res.status, 1, res.stdout + res.stderr)
  assert.match(res.stdout, /^app\/components\/Row\.vue:7 lint /m)
})
