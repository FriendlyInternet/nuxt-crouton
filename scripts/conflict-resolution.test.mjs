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

// ── verify, end to end (#3322): the real CLI in a temp repo mid-merge ──
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('./conflict-resolution.mjs', import.meta.url))

function midMerge({ attrs = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put('a.md', 'one\n'); put('keep.md', 'ok\n'); git('add', '-A'); git('commit', '-qm', 'base0')
  git('checkout', '-qb', 'work'); put('a.md', 'one\nside\n'); git('commit', '-qam', 'side')
  git('checkout', '-q', 'main'); put('a.md', 'one\nbase\n'); put('keep.md', 'ok   \n\n\n'); put('other.md', 'x  \n')
  if (attrs) put('.gitattributes', 'a.md merge=union\n')
  git('add', '-A'); git('commit', '-qm', 'base1')
  git('checkout', '-q', 'work')
  if (attrs) writeFileSync(join(dir, '.git/info/attributes'), 'a.md merge=union\n')
  const m = git('merge', '--no-edit', 'main')
  const verify = (choice = join(dir, 'none.md')) => spawnSync('node', [CLI, 'verify', choice], { cwd: dir, encoding: 'utf8' })
  return { dir, git, put, verify, m }
}

test('verify: resolved file passes despite whitespace in untouched base files', () => {
  const r = midMerge()
  r.put('a.md', 'one\nbase\nside\n')
  const v = r.verify()
  assert.equal(v.status, 0, v.stderr)
  assert.equal(r.git('commit', '-qm', 'merge').status, 0)
  assert.equal(r.git('rev-list', '--parents', '-n1', 'HEAD').stdout.trim().split(' ').length, 3)
})

test('verify: markers left -> exit 1 naming the file', () => {
  const r = midMerge()
  const v = r.verify()
  assert.equal(v.status, 1)
  assert.match(v.stderr, /a\.md/)
})

test('verify: a choice file -> exit 3', () => {
  const r = midMerge()
  const c = join(r.dir, 'choice.md'); writeFileSync(c, 'A vs B')
  assert.equal(r.verify(c).status, 3)
})

test('verify: whitespace the resolver adds in a conflicted file fails, naming it', () => {
  const r = midMerge()
  r.put('a.md', 'one\nbase   \nside\n')
  const v = r.verify()
  assert.equal(v.status, 1)
  assert.match(v.stderr, /a\.md/)
})

test('stale branch with base .gitattributes seeded in info/attributes: merge=union leaves no conflict', () => {
  const r = midMerge({ attrs: true })
  assert.equal(r.git('diff', '--name-only', '--diff-filter=U').stdout.trim(), '')
})
