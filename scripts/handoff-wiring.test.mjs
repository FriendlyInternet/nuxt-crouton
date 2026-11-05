// Wiring test (#3306): every pipeline hand-off — a workflow dispatch or a label add — must go through
// handoff-exec / handoffGuard (limit / 5xx are saved + replayed), or be an allow-listed exclusion with a
// reason. It scans .github/workflows/*.yml and scripts/**/*.{mjs,sh} for EVERY call form, so a new
// hand-off added tomorrow without the wrapper fails here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
export const DISPATCH = /gh workflow run|gh workflow dispatch|createWorkflowDispatch\s*\(|\[\s*'workflow'\s*,\s*'run'|repos\/[^\s'"]*\/dispatches|actions\/workflows\/[^\s'"]*\/dispatches/
export const LABEL = /--add-label|addLabels\s*\(|\/labels'\s*\)|\/labels`|labels\[\]=|ghAddLabel\s*\(|addLabel\s*\(/
const HANDLED = /handoff-exec|handoffGuard|handoffExec|deferHandoff/
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === '__fixtures__' || n === '.git') continue
    const p = join(d, n)
    statSync(p).isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
export const files = () => [
  ...walk(join(ROOT, '.github/workflows')).filter((f) => f.endsWith('.yml')),
  ...walk(join(ROOT, 'scripts')).filter((f) => /\.(mjs|sh)$/.test(f) && !/\.test\.mjs$/.test(f) && !/scripts\/handoff-exec\.mjs$/.test(f)),
]
export function hits(text, re) {
  const L = text.split('\n'); const out = []
  L.forEach((line, i) => {
    if (!re.test(line)) return
    if (/^\s*(#|\/\/|\*)/.test(line)) return // comment line
    if (/^\s*(export )?(const|function)\s+\w*(AddLabel|addLabel)\b/.test(line)) return // a definition, not a call
    const ctx = L.slice(Math.max(0, i - 12), i + 5).join('\n')
    out.push({ line: i + 1, text: line.trim(), handled: HANDLED.test(ctx) })
  })
  return out
}

// Excluded on purpose: [file suffix, substring of the line, why]
export const ALLOW = [
  ['canary.yml', '--add-label', 'synthetic probe with its own 25 s tripwire that reruns on cron; replaying a stale probe would report a false result'],
  ['alfred-deploy-trigger.sh', 'workflow run', 'deploy dispatch, not a pipeline hand-off'],
  ['loop-station-inventory.yml', 'workflow run', 'deploy dispatch, not a pipeline hand-off'],
  ['weekly.yml', 'workflow run', 'deploy dispatch, not a pipeline hand-off'],
  ['apply-decompose-plan.mjs', 'ghAddLabel(exec, repo, a.issue, a.label)', 'ensure-label: the descriptive `epic` label; adding it twice is the wanted no-op'],
  ['label-ready-epics.mjs', '/labels`', 'managed epic status labels, not a stage start'],
]
const allowed = (file, text) => ALLOW.some(([f, sub]) => file.endsWith(f) && text.includes(sub))

// Label adds that are state, not a stage start: status:*, plan:unverified, counters, managed epic labels, test-card state.
const STATE_LABEL = /status:[\w-]+|plan:unverified|ci-fix-attempts|handoff:pending|ready-epic|test-card|'epic'|"epic"|\$\{?[A-Z_]*LABEL/i

function classifyHit(rel, text, kind, h, used) {
  if (h.handled) return null
  if (allowed(rel, h.text)) { ALLOW.forEach(([af, sub], i) => { if (rel.endsWith(af) && h.text.includes(sub)) used.add(i) }); return null }
  const ctx = text.split('\n').slice(Math.max(0, h.line - 3), h.line + 1).join(' ')
  const stateOnly = STATE_LABEL.test(`${h.text} ${ctx}`) && !/work-this|delegate|plan:approved|build:approved|tickets:approved|\[label\]|\[releaseWith\]|"\$L"|a\.label/.test(h.text)
  return kind === 'label' && stateOnly ? null : `${rel}:${h.line} ${kind}: ${h.text}`
}

function scan() {
  const bad = []; const used = new Set(); const totals = { dispatch: 0, label: 0 }
  for (const f of files()) {
    const rel = relative(ROOT, f); const text = readFileSync(f, 'utf8')
    for (const [kind, re] of [['dispatch', DISPATCH], ['label', LABEL]]) {
      for (const h of hits(text, re)) {
        totals[kind]++
        const miss = classifyHit(rel, text, kind, h, used)
        if (miss) bad.push(miss)
      }
    }
  }
  return { bad, used, totals }
}

test('positive fixtures: each call form is matched by its pattern (a pattern that matches nothing fails)', () => {
  for (const s of ['gh workflow run x.yml -f a=b', 'await github.rest.actions.createWorkflowDispatch({', "exec('gh', ['workflow', 'run', 'ticket-review.yml'])", 'gh api repos/o/r/actions/workflows/1/dispatches'])
    assert.ok(DISPATCH.test(s), s)
  for (const s of ['gh issue edit 1 --add-label x', 'await github.rest.issues.addLabels({', "exec('gh', ['api', issueApi(repo, n, '/labels')])", '-f labels[]=x', 'ghAddLabel(exec, repo, n, l)', 'labels: [label]'.replace('labels: [label]', 'addLabels( { labels: [label] })')])
    assert.ok(LABEL.test(s), s)
  assert.equal(hits('  await handoffGuard({}, () => github.rest.issues.addLabels({ labels: [label] }))', LABEL)[0].handled, true)
  assert.equal(hits('gh issue edit 1 --add-label work-this', LABEL)[0].handled, false)
})

test('every dispatch and stage-start label goes through handoff-exec, or is allow-listed', () => {
  const { bad, totals } = scan()
  console.log(`corpus: ${totals.dispatch} dispatch lines, ${totals.label} label lines`)
  assert.deepEqual(bad, [])
})

test('allow-list has no stale entries; on-comment.yml is scanned and wrapped', () => {
  const { used } = scan()
  assert.deepEqual(ALLOW.map((_, i) => i).filter((i) => !used.has(i)), [])
  assert.ok(files().some((f) => f.endsWith('on-comment.yml')))
  const oc = readFileSync(join(ROOT, '.github/workflows/on-comment.yml'), 'utf8')
  assert.ok((oc.match(/handoffGuard\(/g) || []).length >= 7)
})

test('push retry is wired: worker pushes call git-push-retry.mjs and the baseline step stashes it', () => {
  const w = readFileSync(join(ROOT, '.github/workflows/work-issue-pidev.yml'), 'utf8')
  assert.match(w, /git-push-retry\.mjs" -u --force-with-lease=/)
  assert.match(w, /git-push-retry\.mjs" -u --force origin/)
  assert.match(w, /cp scripts\/git-push-retry\.mjs "\$RUNNER_TEMP\/git-push-retry\.mjs"/)
  assert.match(readFileSync(join(ROOT, '.github/workflows/fix-ci-on-failure.yml'), 'utf8'), /node scripts\/git-push-retry\.mjs origin/)
})

// Review round (#3306): the READS inside a hand-off and the hand-back comment POST are part of the step.
// A read/POST outside the guard dies on a rate limit before the guard is ever reached.
test('reads and the hand-back POST sit inside the protected hand-off step', () => {
  const oc = readFileSync(join(ROOT, '.github/workflows/on-comment.yml'), 'utf8')
  const fix = readFileSync(join(ROOT, '.github/workflows/fix-ci-on-failure.yml'), 'utf8')
  // every pulls.list / pulls.get in on-comment.yml that precedes a dispatch must be within a handoffGuard callback
  const L = oc.split('\n')
  L.forEach((line, i) => {
    if (!/rest\.pulls\.(list|get)\(/.test(line) || /^\s*(#|\/\/)/.test(line)) return
    const before = L.slice(Math.max(0, i - 6), i + 1).join('\n')
    const after = L.slice(i, i + 12).join('\n')
    if (!/createWorkflowDispatch/.test(after)) return // a read that feeds no dispatch is not a hand-off read
    assert.match(before, /handoffGuard\(/, `on-comment.yml:${i + 1} reads before a dispatch outside handoffGuard`)
  })
  assert.doesNotMatch(fix, /issues\/\$ISSUE\/comments" --method POST/, 'fix-ci hand-back POST must run inside handoff-exec')
  assert.match(fix, /postBodyFile/)
})

// #3361: the merge check saves a retry, the safety net never goes red on the limit, the sweep isn't cron-only.
test("merge check's outer catch goes through deferMergeCheck", () => {
  const a = readFileSync(join(ROOT, '.github/workflows/automerge-epic-subpr.yml'), 'utf8')
  for (const t of ['workflow_dispatch:', 'deferMergeCheck(e, currentPr', 'HANDOFF_FALLBACK_TOKEN', 'issues: write']) assert.ok(a.includes(t), t)
  const merge = a.slice(0, a.indexOf('Sweep — dispatch build review'))
  assert.ok(!merge.includes('deferOrThrow(e, core.warning)'))
})
test('build-review safety net defers the limit', () => {
  const a = readFileSync(join(ROOT, '.github/workflows/automerge-epic-subpr.yml'), 'utf8')
  assert.ok(a.slice(a.indexOf('Sweep — dispatch build review')).includes('deferOrThrow(e, core.warning)'))
})
test('hand-off sweep does not depend on cron alone', () => {
  const h = readFileSync(join(ROOT, '.github/workflows/handoff-sweep.yml'), 'utf8')
  assert.ok(h.includes('workflow_run:') && h.includes('workflows: ["CI"]'))
})
