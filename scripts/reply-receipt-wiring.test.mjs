// node --test scripts/reply-receipt-wiring.test.mjs — the reply receipt's wiring in on-comment.yml (#4207).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
/** The text of one top-level job, up to the next job. */
function job(name) {
  const start = src.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const rest = src.slice(start + 1)
  const next = rest.slice(1).search(/\n  [a-z][\w-]*:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}
/** The steps of a job, split on `      - `. */
const steps = (j) => j.split(/\n      - /).slice(1)

// covers: T5
test('T5 route exposes record_comment and reason, set from holdFacts and the decision', () => {
  const r = job('route')
  assert.match(r, /\n      record_comment: \$\{\{ steps\.route\.outputs\.record_comment \}\}/)
  assert.match(r, /\n      reason: \$\{\{ steps\.route\.outputs\.reason \}\}/)
  assert.match(r, /core\.setOutput\('record_comment', facts\.recordComment \? String\(facts\.recordComment\) : ''\)/)
  assert.match(r, /core\.setOutput\('reason', d\.reason \|\| ''\)/)
})

// covers: T5
test('T5 the receipt job: needs route, only on a record, one-at-a-time per question, App token, never blocks', () => {
  const j = job('receipt')
  assert.match(j, /\n    needs: route\n/)
  assert.match(j, /\n    if: needs\.route\.outputs\.record_comment != ''\n/)
  assert.match(j, /\n    concurrency:\n      group: reply-receipt-\$\{\{ needs\.route\.outputs\.record_comment \}\}\n      cancel-in-progress: false\n/)
  assert.match(j, /\n    permissions:\n      contents: read\n    steps:/)
  const s = steps(j)
  const token = s.find((x) => x.includes('actions/create-github-app-token'))
  assert.ok(token, 'mints the Harness App token')
  assert.match(token, /continue-on-error: true/)
  assert.match(token, /secrets\.HARNESS_APP_ID/)
  const run = s.find((x) => x.includes('run: node scripts/lib/reply-receipt.mjs'))
  assert.ok(run, 'runs the receipt script')
  assert.match(run, /continue-on-error: true/)
  assert.match(run, /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/)
  assert.match(run, /COMMENT_ID: \$\{\{ needs\.route\.outputs\.record_comment \}\}/)
  assert.match(run, /REASON: \$\{\{ needs\.route\.outputs\.reason \}\}/)
  assert.match(run, /REPLY_URL: \$\{\{ github\.event\.comment\.html_url \}\}/)
  assert.match(run, /REPLY_AT: \$\{\{ github\.event\.comment\.created_at \}\}/)
  // free text only through env: the run line interpolates nothing
  assert.match(run, /\n        run: node scripts\/lib\/reply-receipt\.mjs\n/)
  assert.doesNotMatch(run.slice(run.indexOf('run:')), /\$\{\{/)
})
