// Contract (#4003): the plan-checks job installs with --ignore-scripts, which skips
// better-sqlite3's native build — so it must rebuild the binding (as the test job has since
// #1880), or any plan Test line that opens a real SQLite DB dies on "Could not locate the
// bindings file". This reads ci.yml and checks the wiring on the real workflow text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
// Same slicer as scripts/plan-checks.test.mjs.
const job = (name) => { const s = ci.indexOf(`\n  ${name}:\n`); const rest = ci.slice(s + 1); const e = rest.slice(1).search(/\n  [a-z][\w-]*:\n/); return e < 0 ? rest : rest.slice(0, e + 1) }

// The step block (from its `- name:`/`- uses:` line up to the next one) containing `needle`.
const stepBlock = (j, needle) => {
  const at = j.indexOf(needle)
  if (at < 0) return null
  const before = j.slice(0, at)
  const start = Math.max(before.lastIndexOf('\n      - name:'), before.lastIndexOf('\n      - uses:'))
  const after = j.slice(at)
  const m = after.search(/\n {6}- (name|uses):/)
  return j.slice(start + 1, m < 0 ? j.length : at + m)
}
const ifLine = (block) => (block.match(/^\s*if:.*$/m) || [''])[0].trim()

// covers: T1
test('plan-checks job rebuilds better-sqlite3 after install, before the plan run, same if:', () => {
  const j = job('plan-checks')
  assert.ok(j.length > 200, 'plan-checks job present')
  const install = j.indexOf('pnpm install --frozen-lockfile --ignore-scripts')
  const rebuild = j.indexOf('run: pnpm rebuild better-sqlite3')
  const run = j.indexOf('plan-checks.mjs run')
  assert.ok(install >= 0, 'install step present')
  assert.ok(rebuild >= 0, 'rebuild step present in plan-checks (#4003)')
  assert.ok(run >= 0, 'plan run step present')
  assert.ok(install < rebuild && rebuild < run, 'order: install < rebuild < run')
  const rebuildBlock = stepBlock(j, 'run: pnpm rebuild better-sqlite3')
  const installBlock = stepBlock(j, 'pnpm install --frozen-lockfile --ignore-scripts')
  assert.equal(ifLine(rebuildBlock), "if: steps.plan.outputs.needs_install == 'true'")
  assert.equal(ifLine(rebuildBlock), ifLine(installBlock), 'rebuild shares the install condition')
  assert.doesNotMatch(rebuildBlock, /\|\|\s*true/, 'a failed rebuild must not be swallowed')
})

// covers: T1
test('test job keeps its better-sqlite3 rebuild after pnpm install', () => {
  const j = job('test')
  const install = j.indexOf('pnpm install')
  const rebuild = j.indexOf('run: pnpm rebuild better-sqlite3')
  assert.ok(install >= 0, 'test job installs')
  assert.ok(rebuild > install, 'test job rebuilds better-sqlite3 after install (#1880)')
})
