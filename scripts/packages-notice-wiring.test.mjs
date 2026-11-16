/**
 * #3701 — text checks that the pi worker workflow feeds the packages notice and copies the
 * ticket's `Packages-approved:` line into the PR body on the FIRST push (the epic-ok-wiring way).
 *
 *   node --test scripts/packages-notice-wiring.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
const ext = readFileSync(new URL('../.pi/extensions/packages-notice.ts', import.meta.url), 'utf8')

function step(startMarker) {
  const i = wf.indexOf(startMarker)
  assert.ok(i >= 0, `step ${startMarker} exists`)
  const rest = wf.slice(i + startMarker.length)
  const next = rest.search(/\n      - (id|name|uses):/)
  return rest.slice(0, next < 0 ? undefined : next)
}

// Count the top-level "…" arguments that follow a printf format, stopping at the `)` that
// closes the outer $(printf …). Quotes inside nested $(…) are not counted.
function countPrintfArgs(after) {
  const quotes = { args: 0, inArg: false }
  let depth = 0
  for (let i = 0; i < after.length; i++) {
    const c = after[i]
    if (c === '$' && after[i + 1] === '(') { depth++; i++; continue }
    if (c === ')' && depth > 0) { depth--; continue }
    if (c === ')' && depth === 0) break // closes the outer $(printf …)
    trackQuote(quotes, c, depth)
  }
  return quotes.args
}

// A top-level `"` toggles in/out of an argument; each opening quote counts as one argument.
function trackQuote(quotes, c, depth) {
  if (c !== '"' || depth !== 0) return
  if (!quotes.inArg) quotes.args++
  quotes.inArg = !quotes.inArg
}

test('Fetch issue body writes issue-labels.json next to issue-body.txt', () => {
  const s = step('- name: Fetch issue body')
  assert.match(s, /issue-body\.txt/)
  assert.match(s, /\$\{process\.env\.RUNNER_TEMP\}\/issue-labels\.json/)
})

test('the extension reads the same two file names the workflow writes', () => {
  assert.match(ext, /"issue-labels\.json"/)
  assert.match(ext, /"issue-body\.txt"/)
  assert.match(ext, /RUNNER_TEMP/)
})

test('the finish step\'s gh pr create body carries the --pr-note line from the whole-PR diff', () => {
  const s = step('- id: finish')
  const line = s.split('\n').find(l => l.includes('--body "$(printf \'Closes #%s'))
  assert.ok(line, 'the create --body printf line exists')
  assert.ok(line.includes('git diff --name-only "$BASE_SHA"..HEAD | node scripts/packages-guard.mjs --pr-note'), 'fed by the whole-PR diff')
  assert.ok(line.includes('--body "$RUNNER_TEMP/issue-body.txt"'))
  assert.ok(line.includes('--labels "$RUNNER_TEMP/issue-labels.json"'))
  assert.ok(line.includes('2>/dev/null || true'), 'never fails the step')

  // printf: one argument per placeholder, so no note shifts into the wrong slot.
  const fmt = /printf '([^']*)'/.exec(line)[1]
  const placeholders = (fmt.match(/%[sb]/g) || []).length
  const after = line.slice(line.indexOf(`'${fmt}'`) + fmt.length + 2)
  const args = countPrintfArgs(after)
  assert.equal(args, placeholders, `printf has ${placeholders} placeholders and ${args} arguments`)
})
