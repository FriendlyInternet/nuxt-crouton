// pipeline-review.yml's trust split (#3254, How to test 3): the job that runs the model holds no write
// scope and its model step has no GitHub token; every checkout keeps no git credentials; the post job runs
// no model and always runs. Dependency-free (no YAML parser), same layout rules as
// workflow-model-isolation.test.mjs.
//   node --test scripts/pipeline-review-workflow.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync('.github/workflows/pipeline-review.yml', 'utf8')

/** job id → its raw text (2-space job headers under `jobs:`). */
function jobs() {
  const out = {}
  let id = null
  const all = text.split('\n')
  for (const line of all.slice(all.findIndex(l => /^jobs:\s*$/.test(l)) + 1)) {
    const h = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (h) { id = h[1]; out[id] = ''; continue }
    if (id) out[id] += line + '\n'
  }
  return out
}
/** The steps of a job, each as raw text (6-space `- ` items). */
const steps = body => body.split(/\n(?=      - )/).slice(1)
const runsModel = s => /\bpi --print\b/.test(s)
const J = jobs()

test('the workflow has count, gather-and-write and post jobs', () => {
  assert.deepEqual(Object.keys(J), ['count', 'gather-and-write', 'post'])
})

test('T3 the model job has no write permission; the model step has no token in env', () => {
  const body = J['gather-and-write']
  assert.ok(runsModel(body), 'gather-and-write runs no model?')
  assert.doesNotMatch(body, /:\s*write\b/)
  assert.doesNotMatch(body, /create-github-app-token|app-token/)
  const model = steps(body).filter(runsModel)
  assert.equal(model.length, 1)
  assert.doesNotMatch(model[0], /GH_TOKEN|GITHUB_TOKEN|github\.token|app-token/)
})

test('T3 every checkout keeps no credentials; the gather checkout has full history', () => {
  const checkouts = text.match(/actions\/checkout@[\s\S]*?(?=\n      - |\n  \S|\n\S|$)/g) || []
  assert.equal(checkouts.length, 3)
  for (const c of checkouts) assert.match(c, /persist-credentials:\s*false/)
  const gatherCheckout = steps(J['gather-and-write']).find(s => /actions\/checkout@/.test(s))
  assert.match(gatherCheckout, /fetch-depth:\s*0\b/)
})

test('T3 post runs no model, runs always, and needs the model job', () => {
  const body = J.post
  assert.ok(!runsModel(body))
  assert.match(body, /^    needs: \[count, gather-and-write\]$/m)
  assert.match(body, /^    if: always\(\) && needs\.count\.outputs\.go == 'true'$/m)
  assert.ok(!runsModel(J.count))
})

test('T3 every job has timeout-minutes; the model step times out before its job', () => {
  for (const [id, body] of Object.entries(J)) assert.match(body, /^    timeout-minutes: \d+$/m, `${id} has no timeout`)
  const job = Number(J['gather-and-write'].match(/^    timeout-minutes: (\d+)$/m)[1])
  const step = Number(steps(J['gather-and-write']).find(runsModel).match(/timeout-minutes: (\d+)/)[1])
  assert.ok(step < job, `model step ${step} ≥ job ${job}`)
})

test('T3 one review at a time: concurrency group pipeline-review, no cancel', () => {
  assert.match(text, /^concurrency:\n  group: pipeline-review\n  cancel-in-progress: false$/m)
})

test('the model tier comes from the registry, the prompt on stdin', () => {
  assert.match(text, /resolve-pipeline-model\.mjs review/)
  assert.match(text, /< "\$D\/prompt\.txt"/)
})
