// The model that reads a comment must never share a runner with a write token (#3068).
//
// A model step runs `pi --print --approve`, which gives it a shell: it can rewrite any file in the
// working folder or append to $GITHUB_ENV. So in on-comment.yml's `interpret-*` jobs, a job that runs
// a model must hold no write scope, no app token and no saved git credentials; and the job that does
// hold the app token must run no model. Dependency-free (no YAML parser), like workflow-timeouts.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync('.github/workflows/on-comment.yml', 'utf8')

/** @returns {Record<string,string>} job id → its raw text (2-space job headers under `jobs:`). */
function jobs() {
  const out = {}
  let id = null
  const body = text.split('\n').slice(text.split('\n').findIndex(l => /^jobs:\s*$/.test(l)) + 1)
  for (const line of body) {
    const h = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (h) { id = h[1]; out[id] = ''; continue }
    if (id) out[id] += line + '\n'
  }
  return out
}

const interpret = Object.entries(jobs()).filter(([id]) => id.startsWith('interpret-'))
const runsModel = body => /\bpi --print\b/.test(body)

test('the interpret jobs exist, split into model and token jobs', () => {
  assert.ok(interpret.some(([, b]) => runsModel(b)), 'no interpret job runs a model')
  assert.ok(interpret.some(([, b]) => /create-github-app-token/.test(b)), 'no interpret job mints the app token')
})

test('a job that runs a model holds no write token and keeps no git credentials', () => {
  for (const [id, body] of interpret.filter(([, b]) => runsModel(b))) {
    assert.doesNotMatch(body, /:\s*write\b/, `${id}: model job has a write permission`)
    assert.doesNotMatch(body, /create-github-app-token|GH_TOKEN|GITHUB_TOKEN|app-token/, `${id}: model job can reach a token`)
    const checkouts = body.match(/actions\/checkout@[\s\S]*?(?=\n      - |\n\S|$)/g) || []
    assert.ok(checkouts.length > 0, `${id}: model job has no checkout?`)
    for (const c of checkouts) assert.match(c, /persist-credentials:\s*false/, `${id}: checkout keeps credentials`)
  }
})

test('the job holding the app token runs no model', () => {
  for (const [id, body] of interpret.filter(([, b]) => /create-github-app-token/.test(b))) {
    assert.ok(!runsModel(body), `${id}: token job also runs a model`)
  }
})
