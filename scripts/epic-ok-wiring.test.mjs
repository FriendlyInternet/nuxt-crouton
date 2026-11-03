/** #3105 — text checks that the epic → main `ok` wiring stays in place. node --test scripts/epic-ok-wiring.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8')
const job = (src, name, next) => src.slice(src.indexOf(`\n  ${name}:`), src.indexOf(`\n  ${next}:`))

test('approve-epic says `ok`, never `lgtm`, and never enables GitHub auto-merge', () => {
  const j = job(read('on-comment.yml'), 'approve-epic', 'close-epic')
  assert.ok(j.length > 200)
  assert.doesNotMatch(j, /lgtm/)
  assert.doesNotMatch(j, /enablePullRequestAutoMerge/)
  assert.match(j, /createWorkflowDispatch/)
  assert.match(j, /ownerMergeGo/)
})

test('fix-ci-on-failure can be started by hand and hands back with the branch', () => {
  const y = read('fix-ci-on-failure.yml')
  assert.match(y, /workflow_dispatch:/)
  assert.match(y, /-f branch="\$BRANCH"/)
  assert.doesNotMatch(y, /github\.event\.workflow_run\.(id|name|html_url)/)
})

test('the sweep decides epic → main with decideEpicMerge', () => {
  assert.match(read('automerge-epic-subpr.yml'), /decideEpicMerge\(\{ pr, checkRuns, go \}\)/)
})
