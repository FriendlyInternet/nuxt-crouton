// Replay fixtures for the build reviewer verdict (#2777). node --test scripts/lib/build-verdict.test.mjs
// The two real PRs (#2723 @217b2903, #2726 @545e2a7b) are not fetchable in CI, so their SHAPE is
// reproduced as diffs: #2723 copied files instead of moving them and loosened a Fallow baseline.
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff, precheck, decide, renderComment, parseVerdict } from './build-verdict.mjs'

const TICKET = 'Move the events routes under [id]. Rule: a team-B row is never reachable by id from team A.'

const copiedDiff = `diff --git a/packages/a/server/api/[teamId]/events.get.ts b/packages/a/server/api/[id]/events.get.ts
similarity index 100%
copy from packages/a/server/api/[teamId]/events.get.ts
copy to packages/a/server/api/[id]/events.get.ts
diff --git a/packages/a/plugin.ts b/packages/a/plugin.ts
index 1..2 100644
--- a/packages/a/plugin.ts
+++ b/packages/a/plugin.ts
@@ -1 +1 @@
-a
+b
diff --git a/.fallow-health-baseline.json b/.fallow-health-baseline.json
index 111..222 100644
--- a/.fallow-health-baseline.json
+++ b/.fallow-health-baseline.json
@@ -1,2 +1,2 @@
-{"max": 10}
+{"max": 40}
`
const cleanDiff = `diff --git a/server/api/[teamId]/events.get.ts b/server/api/[id]/events.get.ts
similarity index 100%
rename from server/api/[teamId]/events.get.ts
rename to server/api/[id]/events.get.ts
diff --git a/tests/team-isolation.test.ts b/tests/team-isolation.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/team-isolation.test.ts
@@ -0,0 +1,3 @@
+it('team A cannot read a team B row by id', () => {})
`

const verdict = (v, rows) => `<!-- build-review:v1 -->
### Verdict
${v}
### Rubric
${[1, 2, 3, 4, 5, 6, 7].map((i) => `- ${i}: ${rows[i] || 'PASS — ok'}`).join('\n')}
### Question
Is the wider scope intended? Recommend yes.
`

test('parseDiff reads copies, renames and added lines', () => {
  const f = parseDiff(copiedDiff)
  assert.equal(f[0].status, 'copied')
  assert.equal(f[0].from, 'packages/a/server/api/[teamId]/events.get.ts')
  assert.deepEqual(parseDiff(cleanDiff).map((x) => x.status), ['renamed', 'added'])
})

test('replay #2723: copies + loosened baseline is no-go even when the model says go', () => {
  const d = decide(copiedDiff, TICKET, verdict('go', {}))
  assert.equal(d.ok, true)
  assert.equal(d.verdict, 'no-go')
  assert.deepEqual(d.failed, ['2', '3'])
  assert.match(d.items['2'].evidence, /events\.get\.ts/)
  assert.match(d.items['3'].evidence, /\.fallow-health-baseline\.json/)
})

test('replay #2726: team-B row reachable by id is no-go on item 1, from the reviewer', () => {
  const d = decide(cleanDiff, TICKET, verdict('no-go', { 1: 'FAIL — GET /api/events/:id returns a team-B row to team A' }))
  assert.equal(d.verdict, 'no-go')
  assert.deepEqual(d.failed, ['1'])
  assert.match(renderComment(d, { round: 1 }), /^\*\*Worker:\*\*/m)
})

test('a clean PR is go', () => {
  const d = decide(cleanDiff, TICKET, verdict('go', {}))
  assert.equal(d.verdict, 'go')
  assert.match(renderComment(d), /Build checked/)
})

test('a gate edit is fine when the ticket names the file', () => {
  assert.deepEqual(precheck(copiedDiff, `${TICKET} Raise .fallow-health-baseline.json`)['3'], undefined)
})

test('a newly skipped test fails item 3', () => {
  const diff = `diff --git a/tests/a.test.ts b/tests/a.test.ts
--- a/tests/a.test.ts
+++ b/tests/a.test.ts
@@ -1,1 +1,1 @@
-it('x', () => {})
+it.skip('x', () => {})
`
  assert.match(precheck(diff, TICKET)['3'].evidence, /skipped/)
})

test('the second no-go is final: held for the owner, no Worker line', () => {
  const d = decide(copiedDiff, TICKET, verdict('go', {}))
  const c = renderComment(d, { round: 2 })
  assert.match(c, /rejected twice/)
  assert.doesNotMatch(c, /^\*\*Worker:\*\*/m)
})

test('a go that contradicts its own rubric, or a missing item, is malformed', () => {
  assert.equal(decide(cleanDiff, TICKET, verdict('go', { 4: 'FAIL — extra file' })).ok, false)
  assert.equal(parseVerdict('<!-- build-review:v1 -->\n### Verdict\ngo\n### Rubric\n- 1: PASS — x').ok, false)
})

// Golden fixtures: .claude/gate-fixtures/build-review/<name>/{ticket.md,verdict.md,expected.json}
const FIX = new URL('../../.claude/gate-fixtures/build-review/', import.meta.url)
test('golden fixtures (#2966, #2935, #3005, #3007) parse to the expected verdict and failures', () => {
  const names = readdirSync(FIX, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  assert.ok(names.length >= 4)
  for (const n of names) {
    const read = (f) => readFileSync(new URL(`${n}/${f}`, FIX), 'utf8')
    const want = JSON.parse(read('expected.json'))
    const d = decide('', read('ticket.md'), read('verdict.md'))
    assert.equal(d.ok, true, n)
    assert.equal(d.verdict, want.verdict, n)
    assert.deepEqual(d.failed, want.failed, n)
    if (want.evidence) assert.match(d.items[want.failed[0]].evidence, new RegExp(want.evidence), n)
  }
})

const cp = (from, to) => `diff --git a/${from} b/${to}
similarity index 100%
copy from ${from}
copy to ${to}
`
const mod = (p) => `diff --git a/${p} b/${p}
index 1..2 100644
--- a/${p}
+++ b/${p}
@@ -1 +1 @@
-a
+b
`

test('#3160: copy of an untouched file outside the ticket and edited packages passes item 2', () => {
  const d = cp('packages/canary-target/vitest.config.ts', 'packages/crouton-devtools/vitest.config.ts') + mod('packages/crouton-devtools/a.ts')
  assert.equal(precheck(d, 'see packages/crouton-feedback/vitest.config.ts and vitest.config.ts')['2'], undefined)
})
test('#3160: copy within an edited package fails item 2', () => {
  const d = cp('packages/a/src/x.ts', 'packages/a/src/utils/x.ts') + mod('packages/a/src/plugin.ts')
  assert.equal(precheck(d, '')['2'].pass, false)
})
test('#3160: copy whose full source path is in the ticket fails item 2', () => {
  assert.equal(precheck(cp('packages/a/x.ts', 'packages/b/x.ts'), 'move packages/a/x.ts')['2'].pass, false)
})
test('#3160: bare file name in ticket and unrelated scope passes item 2', () => {
  assert.equal(precheck(cp('packages/a/x.ts', 'packages/b/x.ts'), 'mention x.ts')['2'], undefined)
})
test('#3160: no copies leaves item 2 untouched', () => {
  assert.equal(precheck(mod('packages/a/x.ts'), '')['2'], undefined)
})

test('#3173: only the final hold carries the final marker, the ok wording and the optional ok-again line', () => {
  const d = decide(copiedDiff, TICKET, verdict('go', {}))
  const final = renderComment(d, { round: 2, okAgain: 'AGAIN-LINE' })
  assert.match(final, /<!-- build-review-final -->/)
  assert.match(final, /reply `ok` to merge as is/)
  assert.match(final, /^AGAIN-LINE$/m)
  assert.doesNotMatch(renderComment(d, { round: 2 }), /AGAIN-LINE/)
  const first = renderComment(d, { round: 1, okAgain: 'AGAIN-LINE' })
  assert.doesNotMatch(first, /build-review-final|AGAIN-LINE/)
})
