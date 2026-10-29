// Replay fixtures for the build reviewer verdict (#2777). node --test scripts/lib/build-verdict.test.mjs
// The two real PRs (#2723 @217b2903, #2726 @545e2a7b) are not fetchable in CI, so their SHAPE is
// reproduced as diffs: #2723 copied files instead of moving them and loosened a Fallow baseline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff, precheck, decide, renderComment, parseVerdict } from './build-verdict.mjs'

const TICKET = 'Move the events routes under [id]. Rule: a team-B row is never reachable by id from team A.'

const copiedDiff = `diff --git a/server/api/[teamId]/events.get.ts b/server/api/[id]/events.get.ts
similarity index 100%
copy from server/api/[teamId]/events.get.ts
copy to server/api/[id]/events.get.ts
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
${[1, 2, 3, 4, 5].map((i) => `- ${i}: ${rows[i] || 'PASS — ok'}`).join('\n')}
### Question
Is the wider scope intended? Recommend yes.
`

test('parseDiff reads copies, renames and added lines', () => {
  const f = parseDiff(copiedDiff)
  assert.equal(f[0].status, 'copied')
  assert.equal(f[0].from, 'server/api/[teamId]/events.get.ts')
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
