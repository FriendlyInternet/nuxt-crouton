// #3313: the plan review lives in on-comment.yml (one workflow starts per issue_comment).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
const job = wf.slice(wf.indexOf('\n  plan-review:\n'), wf.indexOf('\n  record-outcome:\n'))

test('plan-review.yml is gone: no second issue_comment workflow', () => {
  assert.equal(existsSync(new URL('../.github/workflows/' + ['plan', 'review.yml'].join('-'), import.meta.url)), false)
})

test('the plan-review job keeps its bot-plan-only, issues-only guard', () => {
  assert.ok(job.length > 100, 'job missing')
  assert.match(job, /!github\.event\.issue\.pull_request/)
  assert.match(job, /comment\.user\.login == 'nuxt-harness\[bot\]'/)
  assert.match(job, /startsWith\(github\.event\.comment\.body, '<!-- pipeline-plan:v1 -->'\)/)
  assert.match(job, /concurrency:\s+group: plan-review-/)
})

test('route and rl-start still skip bots (the plan job is the only bot path)', () => {
  const head = wf.slice(0, wf.indexOf('\n  automerge-go:\n'))
  assert.equal(head.split("github.event.comment.user.type != 'Bot'").length - 1, 2)
})
