// Wiring assertions for the revise push-truth checks (#3347): read the workflow as text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')

function verifyLines(src) {
  return src.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => /revise-push\.mjs"? verify /.test(l))
}

test('12 every verify compares against $BASE_TARGET, never BASE_SHA', () => {
  const vs = verifyLines(SRC)
  assert.ok(vs.length >= 2, 'revise step + finish step')
  for (const { l } of vs) {
    const args = l.split(/ verify /)[1].trim().split(/\s+/)
    assert.equal(args[1], '"$BASE_TARGET"')
    assert.ok(!l.includes('BASE_SHA'))
  }
  assert.ok(!/base_sha=/.test(SRC))
  assert.ok(!/^\s*BASE_SHA:/m.test(SRC))
})

test('12b a BASE_SHA swapped in would be caught', () => {
  const broken = SRC.replace(/verify "\$GITHUB_REPOSITORY" "\$BASE_TARGET"/, 'verify "$GITHUB_REPOSITORY" "$BASE_SHA"')
  assert.notEqual(broken, SRC)
  assert.ok(verifyLines(broken).some(({ l }) => l.includes('BASE_SHA')))
})

test('13 BASE_TARGET is set before each verify (finish: after revise-base.mjs)', () => {
  const lines = SRC.split('\n')
  const vs = verifyLines(SRC).map(v => v.i)
  const sets = lines.map((l, i) => (/^\s*BASE_TARGET="\$\(git rev-parse "origin\/\$\{BASE\}"\)"/.test(l) ? i : -1)).filter(i => i >= 0)
  assert.equal(sets.length, 2)
  assert.ok(sets[0] < vs[0] && sets[1] < vs[1] && sets[1] > vs[0])
  const rb = lines.findIndex(l => l.includes('revise-base.mjs" "origin/'))
  assert.ok(rb >= 0 && rb < sets[1])
})

test('14 "this PR changed" text only in the moved branch', () => {
  assert.equal(SRC.split('this PR changed while I was working').length - 1, 1)
  const i = SRC.indexOf('this PR changed while I was working')
  assert.match(SRC.slice(Math.max(0, i - 900), i), /"\$PUSH_WHY" = "moved"/)
})

test('15 revise step verifies before the #2941 comment; baseline copies the script', () => {
  const v = SRC.indexOf('revise-push.mjs" verify')
  const c = SRC.indexOf('_revision (#2941)_')
  assert.ok(v > 0 && v < c)
  assert.match(SRC, /cp scripts\/revise-push\.mjs "\$RUNNER_TEMP\/revise-push\.mjs"/)
})

test('16 early verify failure fails the run with the numbers (not just a warning)', () => {
  const v = SRC.indexOf('revise-push.mjs" verify')
  const elseAt = SRC.indexOf('else', v)
  const block = SRC.slice(elseAt, SRC.indexOf('fi', SRC.indexOf('exit 1', elseAt)) + 2)
  assert.match(block, /::error::\$\{VERIFY_MSG\}/)
  assert.match(block, /\$VERIFY_MSG/)
  assert.match(block, /exit 1/)
  assert.ok(!block.includes('::warning::${VERIFY_MSG}'))
})
