import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const jq = fileURLToPath(new URL('./best-plan.jq', import.meta.url))
const run = (comments, fb) => execFileSync('jq', ['-r', '--argjson', 'fb', String(fb), '-f', jq], { input: JSON.stringify(comments) }).toString().trim()

// #3341's real comment ids
const plan = (id, n) => ({ id, body: `<!-- pipeline-plan:v1 -->\nplan ${n}` })
const review = (id, ticks) => ({ id, body: `<!-- plan-review-verdict:v1 -->\n${'✅ '.repeat(ticks)}` })

test('the plan the feedback review just graded gets its score', () => {
  const comments = [plan(6628009979, 'A'), plan(6628133312, 'B'), review(6628185357, 5)]
  assert.match(run(comments, 6628185357), /plan B/)
})

test('an earlier higher-scored plan still wins over a lower-scored later one', () => {
  const comments = [plan(1, 'A'), review(2, 6), plan(3, 'B'), review(4, 2)]
  assert.match(run(comments, 4), /plan A/)
})

test('comments after the feedback are ignored', () => {
  const comments = [plan(1, 'A'), review(2, 1), plan(10, 'late'), review(11, 9)]
  assert.match(run(comments, 2), /plan A/)
})

test('a comment that only quotes the plan marker is not taken for a plan (#3359)', () => {
  const quoter = { id: 5, body: 'Review of the plan:\n> <!-- pipeline-plan:v1 -->\nquoted <!-- pipeline-plan:v1 --> inline' }
  const comments = [plan(1, 'real'), quoter, review(6, 1)]
  assert.match(run(comments, 6), /plan real/)
})
