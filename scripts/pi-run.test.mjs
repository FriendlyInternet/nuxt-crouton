// #3620 — the `pi` step's decisions, moved out of work-issue-pidev.yml into scripts/pi-run.mjs.
// Pure refactor, so the contract is "same as before": (R1) the prompt is byte-equal to what the old
// bash built (fixtures/pi-run/old-step.sh, frozen at 1f901a0e; goldens captured from it); (R2) the
// $GITHUB_OUTPUT lines are unchanged and a missing pi exit is a failure; (R3) the files the step
// leaves for later steps are unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  branchInstr, promptMode, feedbackWho, OWNER_WHO, REVIEWER_WHO, extractDecisions, isFresh,
  planFeedbackAppendix, buildPrompt, healPrompt, stepOutputs,
} from './pi-run.mjs'
import { renderPrompt } from './pipeline-prompt.mjs'
import { fakeGh } from './fixtures/pi-run/fake-gh.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FX = join(ROOT, 'scripts/fixtures/pi-run')
const CLI = join(ROOT, 'scripts/pi-run.mjs')
const read = (f) => readFileSync(join(FX, f), 'utf8')
const cases = JSON.parse(read('cases.json'))
const golden = JSON.parse(read('golden.json'))
const ghData = JSON.parse(read('gh-data.json'))
const REPO = 'o/r'

/** A fresh RUNNER_TEMP seeded with the input files a case needs (feedback.txt / conflict-task.txt). */
function runnerTemp(c) {
  const rt = mkdtempSync(join(tmpdir(), 'pi-run-rt-'))
  if (c.feedback) copyFileSync(join(FX, 'feedback.txt'), join(rt, 'feedback.txt'))
  if (c.conflictTask) copyFileSync(join(FX, 'conflict-task.txt'), join(rt, 'conflict-task.txt'))
  return rt
}
const filesIn = (dir, skip = []) => Object.fromEntries(readdirSync(dir).filter((f) => !skip.includes(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
const expectedPrompt = (g) => renderPrompt(g.agent, Object.fromEntries(Object.entries(g.vars).map(([k, v]) => [k, v.startsWith('@') ? read(v.slice(1)) : v]))) + g.tail
/** The files with a reader after the step: approved-plan.txt (finish step), feedback.txt in plan mode. */
const handoff = (files, agent) => Object.fromEntries(Object.entries(files).filter(([f]) => f === 'approved-plan.txt' || (f === 'feedback.txt' && agent === 'pi-planner')))

// A `gh` on PATH answering from gh-data.json, for the real CLI and the frozen bash.
const BIN = mkdtempSync(join(tmpdir(), 'pi-run-bin-'))
writeFileSync(join(BIN, 'gh'), `#!/bin/sh\nexec node "${join(FX, 'fake-gh.mjs')}" "$@"\n`)
chmodSync(join(BIN, 'gh'), 0o755)
function procEnv(c, rt, extra = {}) {
  return { PATH: `${BIN}:${process.env.PATH}`, HOME: process.env.HOME || '/tmp', RUNNER_TEMP: rt, GITHUB_REPOSITORY: REPO, FAKE_GH_DATA: join(FX, 'gh-data.json'), ...(c.fail ? { FAKE_GH_FAIL: c.fail } : {}), ...c.env, ...extra }
}
const runCli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, env, encoding: 'utf8' })

// 1
test('branchInstr: main by default, the integration branch when set', () => {
  assert.equal(branchInstr(''), 'branch off main and target the PR at main')
  assert.equal(branchInstr(undefined), 'branch off main and target the PR at main')
  assert.equal(branchInstr('epic/1--x'), "branch off the integration branch 'epic/1--x' and target the PR THERE (not main)")
})

// 2
test('promptMode: plan wins, revise+conflict → resolver, revise → reviser, else worker', () => {
  assert.equal(promptMode({ plan: '1', revise: '1', conflict: '1' }), 'pi-planner')
  assert.equal(promptMode({ revise: '1', conflict: '1' }), 'pi-conflict-resolver')
  assert.equal(promptMode({ revise: '1', conflict: '' }), 'pi-reviser')
  assert.equal(promptMode({}), 'pi-worker')
})

// 3
test('feedbackWho: only Bot gets the reviewer wording; User and a failed read ("") get the OWNER wording', () => {
  assert.equal(feedbackWho('Bot'), REVIEWER_WHO)
  assert.equal(feedbackWho('User'), OWNER_WHO)
  assert.equal(feedbackWho(''), OWNER_WHO)
})

// 4
test('extractDecisions: header + bullets, stops at the next "## "', () => {
  const body = '## Hypothesis\nx\n## Decisions\n- a\n- b\n## 🧪 How to test\n1. y\n'
  assert.equal(extractDecisions(body), '## Decisions\n- a\n- b\n')
})
test('extractDecisions: trailing spaces/tabs on the header are allowed', () => {
  assert.equal(extractDecisions('## Decisions \t\n- a\n'), '## Decisions \t\n- a\n')
})
test('extractDecisions: no section → empty', () => {
  assert.equal(extractDecisions('## Hypothesis\nx\n'), '')
  assert.equal(extractDecisions(''), '')
})
test('extractDecisions: "### Decisions" is not a match (and stays inside a real section)', () => {
  assert.equal(extractDecisions('### Decisions\n- no\n'), '')
  assert.equal(extractDecisions('## Decisions\n- a\n### Decisions (sub)\nkept\n## Next\n'), '## Decisions\n- a\n### Decisions (sub)\nkept\n')
})
test('extractDecisions matches the awk it replaces on a real body', () => {
  const body = `${ghData.issues['2'].body}\n`
  const awk = spawnSync('awk', ['/^## Decisions[ \\t]*$/{f=1;print;next} /^## /{f=0} f'], { input: body, encoding: 'utf8' })
  assert.equal(awk.status, 0)
  assert.equal(extractDecisions(body), awk.stdout)
})

// 5
test('isFresh: case-insensitive, in the feedback or in the decisions', () => {
  assert.equal(isFresh('Let us START Fresh.\n', ''), true)
  assert.equal(isFresh('ok\n', '## Decisions\n- 2026-11-01 start fresh on the plan\n'), true)
  assert.equal(isFresh('ok\n', '## Decisions\n- keep it\n'), false)
})

// 6
test('planFeedbackAppendix: the three shapes equal the captured bash output', () => {
  const fb101 = `${ghData.comments['101'].body}\n`
  const prev = '<!-- pipeline-plan:v1 -->\n### Fix\nplan one\n\n'
  const dec = extractDecisions(`${ghData.issues['2'].body}\n`)
  const fb103 = `${ghData.comments['103'].body}\n`
  assert.equal(planFeedbackAppendix({ who: OWNER_WHO, feedback: fb103, fresh: true, prevPlan: prev, decisions: '' }), golden['plan-fresh'].tail)
  assert.equal(planFeedbackAppendix({ who: REVIEWER_WHO, feedback: fb101, fresh: false, prevPlan: prev, decisions: '' }), golden['plan-bot'].tail)
  assert.equal(planFeedbackAppendix({ who: REVIEWER_WHO, feedback: fb101, fresh: false, prevPlan: prev, decisions: dec }), golden['plan-decisions'].tail)
})

// 7 + 8 (non-throwing failure rules): every case, byte-equal to the golden captured from old-step.sh
for (const [name, c] of Object.entries(cases)) {
  if (c.throws) continue
  test(`buildPrompt [${name}] is byte-equal to the old bash and leaves the same hand-off files`, async () => {
    const rt = runnerTemp(c)
    const out = await buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: rt, ...c.env }, { gh: fakeGh(ghData, c.fail) })
    const g = golden[name]
    assert.equal(out, expectedPrompt(g))
    assert.deepEqual(handoff(filesIn(rt), g.agent), g.files)
  })
}

test('buildPrompt [worker-approved] appends the plan-held section', async () => {
  const c = cases['worker-approved']
  const out = await buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: runnerTemp(c), ...c.env }, { gh: fakeGh(ghData) })
  assert.match(out, /AN INDEPENDENT REVIEWER APPROVED THIS PLAN \(comment 200, #2757\)/)
  assert.ok(out.endsWith(`--- APPROVED PLAN ---\n${ghData.comments['200'].body}\n`))
})

test('buildPrompt [fail-user-type]: a failed user.type read still renders, with the OWNER wording', async () => {
  const c = cases['fail-user-type']
  const out = await buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: runnerTemp(c), ...c.env }, { gh: fakeGh(ghData, c.fail) })
  assert.ok(out.includes(`SENT BACK (${OWNER_WHO})`))
})

// 8 (throwing failure rules)
test('buildPrompt throws when the feedback fetch fails', async () => {
  const c = cases['fail-feedback']
  await assert.rejects(buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: runnerTemp(c), ...c.env }, { gh: fakeGh(ghData, c.fail) }), /forced failure/)
})
test('buildPrompt throws when the approved-plan fetch fails', async () => {
  const c = cases['fail-approved']
  await assert.rejects(buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: runnerTemp(c), ...c.env }, { gh: fakeGh(ghData, c.fail) }), /forced failure/)
})
test('buildPrompt does not throw when the previous-plan, Decisions or PR reads fail — it renders with empties', async () => {
  for (const name of ['fail-prev-plan', 'fail-decisions', 'fail-pr-lookup']) {
    const c = cases[name]
    const out = await buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: runnerTemp(c), ...c.env }, { gh: fakeGh(ghData, c.fail) })
    assert.equal(out, expectedPrompt(golden[name]), name)
  }
  const c = cases['plan-bot']
  const out = await buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: runnerTemp(c), ...c.env }, { gh: fakeGh(ghData), jqBestPlan: () => { throw new Error('jq broke') } })
  assert.ok(!out.includes('PREVIOUS PLAN (revise this)'))
})
test('buildPrompt throws on a persona render error (a missing --var-file input)', async () => {
  const c = cases.conflict
  const rt = runnerTemp({ feedback: true })
  await assert.rejects(buildPrompt({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: rt, ...c.env }, { gh: fakeGh(ghData) }), /conflict-task\.txt/)
})

// 9
test('healPrompt: the old header, then the errors', () => {
  const p = healPrompt('E1')
  assert.ok(p.startsWith('The Vue file(s) you just edited DO NOT COMPILE.'))
  assert.ok(p.endsWith('The exact errors:\n\nE1'))
})

// 10 — the clear-fail case for "pi never ran or crashed"
test('stepOutputs: success only for rc 0; a missing rc is a failure', () => {
  assert.equal(stepOutputs({ rc: 0, start: 100, end: 160, log: 'x.log' }), 'wall=60\nconclusion=success\nexec_log=x.log\n')
  assert.equal(stepOutputs({ rc: '0', start: '1', end: '3', log: 'l' }), 'wall=2\nconclusion=success\nexec_log=l\n')
  assert.match(stepOutputs({ rc: 1, start: 0, end: 0, log: 'l' }), /^conclusion=failure$/m)
  assert.match(stepOutputs({ rc: undefined, start: 0, end: 0, log: 'l' }), /^conclusion=failure$/m)
  assert.match(stepOutputs({ rc: '', start: 0, end: 0, log: 'l' }), /^conclusion=failure$/m)
  assert.match(stepOutputs({ rc: 'abc', start: 0, end: 0, log: 'l' }), /^conclusion=failure$/m)
})

// 11 — the CLI, as the step runs it
test('CLI prompt prints the prompt; a throw exits non-zero (the step fails under bash -e)', () => {
  const ok = runCli(['prompt'], procEnv(cases.worker, runnerTemp(cases.worker)))
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stdout, expectedPrompt(golden.worker))
  const bad = runCli(['prompt'], procEnv(cases['fail-approved'], runnerTemp(cases['fail-approved'])))
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /pi-run:/)
})
test('CLI heal and outputs', () => {
  const rt = mkdtempSync(join(tmpdir(), 'pi-run-heal-'))
  writeFileSync(join(rt, 'errs.txt'), 'a.vue: unclosed <div>\n')
  assert.equal(runCli(['heal', join(rt, 'errs.txt')], process.env).stdout, healPrompt('a.vue: unclosed <div>\n'))
  const o = runCli(['outputs', '--rc', '', '--start', '10', '--end', '15', '--log', 'decompose-pidev-exec-1.log'], process.env)
  assert.equal(o.stdout, 'wall=5\nconclusion=failure\nexec_log=decompose-pidev-exec-1.log\n')
})
test('CLI heal/outputs work from a lone copy (the $RUNNER_TEMP copy has no sibling files)', () => {
  const rt = mkdtempSync(join(tmpdir(), 'pi-run-copy-'))
  copyFileSync(CLI, join(rt, 'pi-run.mjs'))
  const o = spawnSync(process.execPath, [join(rt, 'pi-run.mjs'), 'outputs', '--rc', '0', '--start', '1', '--end', '2', '--log', 'l'], { encoding: 'utf8' })
  assert.equal(o.status, 0, o.stderr)
  assert.equal(o.stdout, 'wall=1\nconclusion=success\nexec_log=l\n')
})

// 12 — hand-off files (R3), through the real CLI with a fake gh on PATH
test('CLI hand-off: approved-plan.txt is byte-equal to the fetched body + one newline', () => {
  const c = cases['worker-approved']
  const rt = runnerTemp(c)
  assert.equal(runCli(['prompt'], procEnv(c, rt)).status, 0)
  assert.equal(readFileSync(join(rt, 'approved-plan.txt'), 'utf8'), `${ghData.comments['200'].body}\n`)
  assert.equal(readFileSync(join(rt, 'approved-plan.txt'), 'utf8'), golden['worker-approved'].files['approved-plan.txt'])
})
test('CLI hand-off: no APPROVED_PLAN_ID → approved-plan.txt is not created', () => {
  const rt = runnerTemp(cases.worker)
  assert.equal(runCli(['prompt'], procEnv(cases.worker, rt)).status, 0)
  assert.equal(existsSync(join(rt, 'approved-plan.txt')), false)
})
test('CLI hand-off: plan + feedback writes feedback.txt = the fetched body + one newline', () => {
  const c = cases['plan-owner']
  const rt = runnerTemp(c)
  assert.equal(runCli(['prompt'], procEnv(c, rt)).status, 0)
  assert.equal(readFileSync(join(rt, 'feedback.txt'), 'utf8'), `${ghData.comments['102'].body}\n`)
})
for (const [name, c] of Object.entries(cases)) {
  if (c.throws) continue
  test(`CLI [${name}] matches a live run of the frozen old bash (prompt + hand-off files)`, () => {
    const rtOld = runnerTemp(c)
    const old = spawnSync('bash', ['-e', join(FX, 'old-step.sh')], { cwd: ROOT, env: procEnv(c, rtOld, { PROMPT_FILE: join(rtOld, 'PROMPT') }), encoding: 'utf8' })
    assert.equal(old.status, 0, old.stderr)
    const rtNew = runnerTemp(c)
    const neu = runCli(['prompt'], procEnv(c, rtNew))
    assert.equal(neu.status, 0, neu.stderr)
    assert.equal(neu.stdout, readFileSync(join(rtOld, 'PROMPT'), 'utf8'))
    const agent = golden[name].agent
    assert.deepEqual(handoff(filesIn(rtNew), agent), handoff(filesIn(rtOld, ['PROMPT']), agent))
  })
}

// 13 — no reader left behind
test('work-issue-pidev.yml: no step reads a scratch file pi-run.mjs no longer writes; approved-plan.txt is still read', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/work-issue-pidev.yml'), 'utf8')
  for (const dropped of ['approved-section.txt', 'prev-plan.txt', 'decisions.txt']) {
    assert.ok(!wf.includes(`$RUNNER_TEMP/${dropped}`), `${dropped} is read in the workflow but pi-run.mjs keeps it in memory`)
  }
  // The finish step's sign-off decision reads the hand-off file pi-run.mjs writes.
  assert.match(wf, /signoff-surface\.mjs[^\n]*--plan "\$RUNNER_TEMP\/approved-plan\.txt"/)
  // The pi step calls the script, and the baseline step stashes the copy the post-pi calls use.
  assert.match(wf, /node scripts\/pi-run\.mjs prompt > "\$PROMPT_FILE"/)
  assert.match(wf, /cp scripts\/pi-run\.mjs "\$RUNNER_TEMP\/pi-run\.mjs"/)
  assert.match(wf, /node "\$RUNNER_TEMP\/pi-run\.mjs" outputs --rc "\$RC"/)
})
