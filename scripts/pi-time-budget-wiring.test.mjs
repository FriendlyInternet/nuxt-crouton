/**
 * #4183 T5 — the pi step has its own time limit, and a timed-out build is saved as a draft.
 * Reads work-issue-pidev.yml and checks the wiring rules. node --test scripts/pi-time-budget-wiring.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
const lines = src.split('\n')

// One step of the work-pi job: from its `- id: <id>` line to the next step at the same indent.
function step(id) {
  const start = lines.findIndex((l) => l === `      - id: ${id}`)
  assert.ok(start >= 0, `step ${id} exists`)
  let end = start + 1
  while (end < lines.length && !/^ {6}- /.test(lines[end]) && !/^ {2}\S/.test(lines[end])) end++
  return lines.slice(start, end).join('\n')
}
// The `run: |` body of a step (the lines after `run: |`, up to the next key at the step's level).
function runBlock(text) {
  const l = text.split('\n')
  const i = l.findIndex((x) => /^ {8}run: \|/.test(x))
  assert.ok(i >= 0, 'has a run: | block')
  let j = i + 1
  while (j < l.length && (l[j] === '' || /^ {10}/.test(l[j]))) j++
  return l.slice(i + 1, j).join('\n')
}

test('#4183 T5: job-start is the first step of work-pi', () => {
  const jobAt = lines.findIndex((l) => l === '  work-pi:')
  assert.ok(jobAt >= 0)
  const stepsAt = lines.findIndex((l, i) => i > jobAt && l === '    steps:')
  const first = lines.slice(stepsAt + 1).find((l) => /^ {6}- /.test(l))
  assert.equal(first, '      - id: job-start')
  assert.match(step('job-start'), /echo "ts=\$\(date \+%s\)" >> "\$GITHUB_OUTPUT"/)
})

// covers: T1
test('#4183 T5 / #4503 T1: budget runs pi-time-budget.mjs minutes from the $RUNNER_TEMP copy, outside plan mode, from the job start', () => {
  const b = step('budget')
  assert.match(b, /if: \$\{\{ inputs\.mode != 'plan' \}\}/)
  assert.match(b, /JOB_START: \$\{\{ steps\.job-start\.outputs\.ts \}\}/)
  assert.match(b, /node "\$RUNNER_TEMP\/scripts\/lib\/pi-time-budget\.mjs" minutes --start "\$JOB_START" >> "\$GITHUB_OUTPUT"/)
  // revise has already checked out the PR branch, which may predate the script (#4503)
  assert.doesNotMatch(b, /node scripts\/lib\/pi-time-budget\.mjs/)
  assert.ok(src.indexOf('      - id: budget') < src.indexOf('      - id: pi\n'), 'budget runs before pi')
})

test('#4183 T5: the pi step\'s timeout-minutes and PI_DEADLINE both read steps.budget.outputs', () => {
  const p = step('pi')
  assert.match(p, /timeout-minutes: \$\{\{ inputs\.mode == 'plan' && 45 \|\| fromJSON\(steps\.budget\.outputs\.pi_minutes \|\| '40'\) \}\}/)
  assert.match(p, /PI_DEADLINE: \$\{\{ steps\.budget\.outputs\.deadline \}\}/)
})

test('#4183 T5: finish and the artifact gate carry PI_OUTCOME from steps.pi.outcome', () => {
  const f = step('finish')
  assert.match(f, /PI_OUTCOME: \$\{\{ steps\.pi\.outcome \}\}/)
  assert.match(f, /PI_DEADLINE: \$\{\{ steps\.budget\.outputs\.deadline \}\}/)
  assert.match(f, /PI_MINUTES: \$\{\{ steps\.budget\.outputs\.pi_minutes \}\}/)
  const gAt = src.indexOf('- name: Artifact-gate — fail if the agent produced nothing')
  assert.ok(gAt >= 0)
  const gate = src.slice(gAt, src.indexOf('        with:', gAt))
  assert.match(gate, /PI_OUTCOME: \$\{\{ steps\.pi\.outcome \}\}/)
  assert.match(gate, /PI_DEADLINE: \$\{\{ steps\.budget\.outputs\.deadline \}\}/)
  assert.match(gate, /PI_MINUTES: \$\{\{ steps\.budget\.outputs\.pi_minutes \}\}/)
})

test('#4183 T5: the finish run: block decides the draft with pi-time-budget.mjs and holds no ${{', () => {
  const r = runBlock(step('finish'))
  assert.ok(r.split('\n').length > 300, 'found the real finish block')
  assert.match(r, /pi-time-budget\.mjs" draft --outcome "\$\{PI_OUTCOME:-\}"/)
  assert.match(r, /\|\| DV="DRAFT=--draft"/, 'a helper crash still drafts the PR')
  assert.match(r, /rm -f \.git\/index\.lock/)
  assert.doesNotMatch(r, /\$\{\{/)
})

test('#4183 T5: held clears a stale ⏱️ line', () => {
  const h = step('held')
  assert.match(h, /PI_OUTCOME: \$\{\{ steps\.pi\.outcome \}\}/)
  assert.match(h, /pi-time-budget\.mjs" clear --branch "\$BR"/)
})
