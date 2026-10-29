// layer: stack
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('./harness-layers.mjs', import.meta.url).pathname
const SKILL = new URL('../.claude/skills', import.meta.url).pathname
const AGENTS = new URL('../.claude/agents', import.meta.url).pathname

// Build a throwaway repo root: real skills/agents (so only the files under test can fail).
function check(files) {
  const root = mkdtempSync(join(tmpdir(), 'layers-'))
  cpSync(SKILL, join(root, '.claude/skills'), { recursive: true })
  cpSync(AGENTS, join(root, '.claude/agents'), { recursive: true })
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  const r = spawnSync('node', [SCRIPT, '--check'], { env: { ...process.env, HARNESS_LAYERS_ROOT: root }, encoding: 'utf8' })
  rmSync(root, { recursive: true, force: true })
  return r
}

test('clean harness file passes', () => {
  assert.equal(check({ 'scripts/a.mjs': '// layer: harness\nconsole.log(1)\n' }).status, 0)
})

test('harness file naming a stack token fails', () => {
  const r = check({ 'scripts/a.mjs': '// layer: harness\n// uses nuxt\n' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /scripts\/a\.mjs: nuxt/)
})

test('stack-tagged file may name the stack', () => {
  assert.equal(check({ 'scripts/a.mjs': '// layer: stack\n// uses nuxt\n' }).status, 0)
})

test('harness-tagged test files are scanned too', () => {
  const r = check({ 'scripts/a.test.mjs': '// layer: harness\n// crouton-x\n' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /a\.test\.mjs/)
})

test('untagged file in a nested scripts folder fails', () => {
  const r = check({ 'scripts/sub/deep.mjs': 'console.log(1)\n' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /scripts\/sub\/deep\.mjs/)
})

test('untagged workflow fails', () => {
  const r = check({ '.github/workflows/x.yml': 'name: x\n' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /workflows\/x\.yml/)
})

for (const s of ['CLOUDFLARE_API_TOKEN', 'NUXT_PUBLIC_X', 'D1_DATABASE_ID', 'nuxt_hub', 'vue3', 'my-nuxt-app']) {
  test(`harness file containing ${s} fails`, () => {
    const r = check({ 'scripts/a.mjs': `// layer: harness\nconst x = '${s}'\n` })
    assert.equal(r.status, 1)
  })
}
