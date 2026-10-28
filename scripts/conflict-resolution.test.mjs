import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatorsFor, withMarkers, verdict, buildPrompt, SCRIPTS_TEST_CMD } from './conflict-resolution.mjs'

// A real conflicted merge: `base` and `side` both edit `file` from a common ancestor.
function conflict(file, ancestor, base, side) {
  const dir = mkdtempSync(join(tmpdir(), 'conflict-'))
  const git = (...a) => { try { return execFileSync('git', a, { cwd: dir, encoding: 'utf8' }) } catch (e) { return e.stdout || '' } }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  const put = (t) => { writeFileSync(join(dir, file), t); git('add', '-A'); git('commit', '-qm', 'c') }
  put(ancestor)
  git('checkout', '-qb', 'work')
  put(side)
  git('checkout', '-q', 'main')
  put(base)
  git('checkout', '-q', 'work')
  git('merge', '--no-edit', 'main')
  return { unmerged: git('diff', '--name-only', '--diff-filter=U').trim(), text: readFileSync(join(dir, file), 'utf8') }
}

test('PR #2781 shape: two tests added at the same spot conflict, and the conflict is detected', () => {
  const head = "import { test } from 'node:test'\n"
  const r = conflict('apply.test.mjs', head, head + "test('base added', () => {})\n", head + "test('pr added', () => {})\n")
  assert.equal(r.unmerged, 'apply.test.mjs')
  assert.deepEqual(withMarkers({ 'apply.test.mjs': r.text }), ['apply.test.mjs'])
  // the resolution keeps both
  const resolved = head + "test('base added', () => {})\ntest('pr added', () => {})\n"
  assert.deepEqual(withMarkers({ 'apply.test.mjs': resolved }), [])
  assert.equal(verdict({ choiceText: '', markerFiles: [] }).status, 'resolved')
})

test('PR #2796 shape: routing.json + its generated registry map to gen-routing (run + --check)', () => {
  const gens = generatorsFor(['.claude/routing.json', 'writeups/architecture/routing-registry.md'])
  assert.deepEqual(gens.map((g) => g.name), ['gen-routing'])
  assert.match(gens[0].check, /gen-routing\.mjs --check/)
})

test('generators are matched by input or output, and unrelated files match none', () => {
  assert.deepEqual(generatorsFor(['pnpm-lock.yaml']).map((g) => g.name), ['lockfile'])
  assert.deepEqual(generatorsFor(['packages/crouton-auth/package.json']).map((g) => g.name), ['gen-package-catalog'])
  assert.deepEqual(generatorsFor(['scripts/foo.mjs']), [])
})

test('both sides editing the same function body ends in a choice, never a silent resolution', () => {
  const anc = 'function f() {\n  return 1\n}\n'
  const r = conflict('f.mjs', anc, 'function f() {\n  return 2\n}\n', 'function f() {\n  return 3\n}\n')
  assert.equal(r.unmerged, 'f.mjs')
  // pi found incompatible intents and wrote a choice: the verdict is `choice` even though markers remain
  const v = verdict({ choiceText: 'A: return 2\nB: return 3\nRecommend A', markerFiles: withMarkers({ 'f.mjs': r.text }) })
  assert.equal(v.status, 'choice')
})

test('a leftover marker without a choice fails loudly', () => {
  const v = verdict({ choiceText: '  \n', markerFiles: ['x.mjs'] })
  assert.equal(v.status, 'failed')
  assert.match(v.reason, /x\.mjs/)
})

test('the prompt names the files, the generators, the choice file and the keep-both rule', () => {
  const p = buildPrompt({ base: 'main', files: ['a.mjs'], choiceFile: '/tmp/choice.md' })
  for (const s of ['- a.mjs', 'gen-routing.mjs', 'pnpm install --lockfile-only', '/tmp/choice.md', 'BOTH sides']) assert.ok(p.includes(s), s)
})

test('scripts test command matches the one CI runs', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.ok(ci.includes(`run: ${SCRIPTS_TEST_CMD}`))
})
