// Every claude-code-action step in review.yml must set `allowed_bots` (#3119).
//
// The action refuses a run started by a bot actor (all pipeline pushes) unless the bot is
// listed, and exits green while refusing — so the reviewers silently never ran. Dependency-free
// text parse, in the style of workflow-timeouts.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lines = readFileSync('.github/workflows/review.yml', 'utf8').split('\n')
const starts = lines.flatMap((l, i) => (/uses:\s*anthropics\/claude-code-action@/.test(l) ? [i] : []))

test('review.yml has the four reviewer agent steps', () => {
  assert.equal(starts.length, 4)
})

test('every claude-code-action step allows the harness bot', () => {
  for (const [n, start] of starts.entries()) {
    const end = starts[n + 1] ?? lines.length
    const block = lines.slice(start, end).join('\n')
    const m = block.match(/^\s*allowed_bots:\s*"([^"]*)"/m)
    assert.ok(m, `step at line ${start + 1} has no allowed_bots`)
    assert.ok(m[1].includes('nuxt-harness[bot]'), `step at line ${start + 1} omits nuxt-harness[bot]`)
  }
})
