// #3251 — every comment a workflow posts that is not agent output must carry the shared
// `<!-- pipeline-note -->` marker at its post site, and every agent workflow must end with a
// `record-outcome` job that runs after every other job (even a failed/cancelled one).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows')
const FILES = ['work-issue-pidev', 'decompose-on-issue-pidev', 'plan-review', 'build-review', 'ticket-review', 'fix-ci-on-failure', 'on-comment']
const SITE = /gh (?:issue|pr) comment|createComment|issues\/[^\s"]*\/comments"[^\n]*--method POST/
const MARK = 'pipeline-note'
const WINDOW = 8

// Sites that are legitimately unmarked at the call. Each needs a reason.
const ALLOW = [
  { file: 'plan-review', has: 'comment.md', reason: 'the review verdict itself — carries its own verdict marker, counted as `verdict`' },
  { file: 'build-review', has: 'comment.md', reason: 'the review verdict itself' },
  { file: 'ticket-review', has: 'comment.md', reason: 'the review verdict itself' },
  { file: 'on-comment', has: 'const say = (brief, more)', reason: "the interpreter's own comment (posted by interpret-act) is agent output" },
  { file: 'work-issue-pidev', has: '--body-file "$REC"', reason: 'run-record file; its first line is the marker (asserted below)', fileHas: 'echo "<!-- pipeline-note -->"' },
  { file: 'fix-ci-on-failure', has: 'handback.md', reason: 'hand-back file; its first line is the marker (asserted below)', fileHas: 'echo "<!-- pipeline-note -->"' },
]

export function findUnmarked(file, text) {
  const lines = text.split('\n')
  const misses = []
  lines.forEach((l, i) => {
    if (!SITE.test(l) || /^\s*#/.test(l)) return
    const win = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join('\n')
    if (win.includes(MARK)) return
    const allowed = ALLOW.find((a) => a.file === file && l.includes(a.has) && (!a.fileHas || text.includes(a.fileHas)))
    if (allowed) return
    misses.push(`${file}.yml:${i + 1}: ${l.trim().slice(0, 100)}`)
  })
  return misses
}

test('lint: a comment post without the marker is reported', () => {
  assert.equal(findUnmarked('x', 'run: gh pr comment "$PR" --body "hi"').length, 1)
  assert.equal(findUnmarked('x', 'run: gh pr comment "$PR" --body "<!-- pipeline-note -->hi"').length, 0)
})

test('lint over the real workflows: every non-output post carries the marker', () => {
  const all = []
  let sites = 0
  for (const f of FILES) {
    const text = readFileSync(join(DIR, `${f}.yml`), 'utf8')
    sites += text.split('\n').filter((l) => SITE.test(l) && !/^\s*#/.test(l)).length
    all.push(...findUnmarked(f, text))
  }
  console.log(`# pipeline-note lint: ${sites} post sites, ${all.length} unmarked`)
  assert.deepEqual(all, [])
  assert.ok(sites > 40)
})

// Scripts the workflows call (via github-script import) that post pipeline notes themselves.
// wave-release.mjs posts gate-formatted hold/release comments from the epic-wave workflows, which
// are not agent runs and are not recorded; traffic-control.mjs posts into the agent run's thread.
const SCRIPTS = ['traffic-control']
const SCRIPT_DIR = join(DIR, '..', '..', 'scripts')

test('lint over the scripts the workflows call: every post carries the marker', () => {
  const all = []
  let sites = 0
  for (const f of SCRIPTS) {
    const text = readFileSync(join(SCRIPT_DIR, `${f}.mjs`), 'utf8')
    sites += text.split('\n').filter((l) => SITE.test(l) && !/^\s*#/.test(l)).length
    all.push(...findUnmarked(f, text))
  }
  console.log(`# pipeline-note lint (scripts): ${sites} post sites, ${all.length} unmarked`)
  assert.deepEqual(all, [])
  assert.ok(sites >= 1)
})

test('record-outcome: runs after every other job, even failed or cancelled ones', () => {
  for (const f of FILES) {
    const text = readFileSync(join(DIR, `${f}.yml`), 'utf8')
    const jobsAt = text.indexOf('\njobs:\n')
    const jobs = [...text.slice(jobsAt).matchAll(/^  ([a-z0-9][\w-]*):\s*$/gm)].map((m) => m[1])
    assert.ok(jobs.includes('record-outcome'), `${f}: no record-outcome job`)
    const block = text.slice(text.indexOf('\n  record-outcome:\n'))
    const needs = /needs: \[([^\]]*)\]/.exec(block)[1].split(',').map((s) => s.trim())
    // on-comment: only the interpret chain is an agent run; dispatch/resume/approve paths get no record.
    const others = jobs.filter((j) => j !== 'record-outcome' && (f !== 'on-comment' || /^(route|interpret-)/.test(j)))
    assert.deepEqual([...needs].sort(), [...others].sort(), `${f}: needs must list every other job`)
    assert.match(block, /if: \$\{\{ always\(\)/, `${f}: record-outcome must run with always()`)
    assert.match(block, /continue-on-error: true/, `${f}: a ledger failure must not fail the run`)
  }
})
