import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/fix-ci-on-failure.yml', import.meta.url), 'utf8')

function gateScript(src) {
  const lines = src.split('\n')
  const g = lines.findIndex(l => /^\s+- id: gate\b/.test(l))
  if (g < 0) return ''
  const s = lines.findIndex((l, i) => i > g && /^\s+script: \|\s*$/.test(l))
  if (s < 0) return ''
  const out = []
  let indent = null
  for (const l of lines.slice(s + 1)) {
    if (l.trim() === '') { out.push(l); continue }
    const ind = l.match(/^\s*/)[0].length
    if (indent === null) indent = ind
    if (ind < indent) break
    out.push(l)
  }
  return out.join('\n')
}

function isDeclared(src, id) {
  return new RegExp(`\\b(const|let|var|function)\\s+${id}\\b|(?<!\\$)[{,]\\s*${id}\\s*[,}]|\\(\\s*${id}\\s*\\)\\s*=>|\\b${id}\\s*=(?!=)`).test(src)
}

const src = gateScript(wf)

test('gate step script is found and non-trivial', () => {
  assert.ok(src.split('\n').length > 50)
  assert.ok(src.includes('fixBotWillTry'))
})

test('every bare ${identifier} the gate script interpolates is declared or imported', () => {
  const names = [...new Set([...src.matchAll(/\$\{([A-Za-z_$][\w$]*)\}/g)].map(m => m[1]))]
  const missing = names.filter(n => !isDeclared(src, n))
  assert.deepEqual(missing, [], `undeclared in gate script: ${missing.join(', ')}`)
})

test('MAX is not referenced unless declared', () => {
  if (/\bMAX\b/.test(src)) assert.ok(isDeclared(src, 'MAX'))
})

test('the cap comes from the helper', async () => {
  assert.match(src, /FIX_BOT_MAX_ATTEMPTS[\s\S]*await import\(|\{[^}]*FIX_BOT_MAX_ATTEMPTS[^}]*\}\s*=\s*await import\([^)]*fix-bot-dispatch\.mjs/)
  const mod = await import('./lib/fix-bot-dispatch.mjs')
  assert.equal(mod.FIX_BOT_MAX_ATTEMPTS, 3)
})
