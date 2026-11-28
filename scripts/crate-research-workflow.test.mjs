import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/crate-research.yml', import.meta.url), 'utf8')

test('crate-research runs nightly and by hand, staging only', () => {
  assert.match(wf, /schedule:\s*\n\s*- cron: '\d+ \d+ \* \* \*'/)
  assert.match(wf, /workflow_dispatch:/)
  assert.match(wf, /CRATE_URL: https:\/\/crate-staging\.pmcp\.dev/)
  assert.doesNotMatch(wf, /https:\/\/crate\.pmcp\.dev/)
})

test('crate-research defaults to 25 tracks and never echoes secrets', () => {
  assert.match(wf, /inputs\.limit \|\| '25'/)
  assert.match(wf, /research\.mjs --limit "\$LIMIT"/)
  assert.doesNotMatch(wf, /echo .*secrets\./)
})
