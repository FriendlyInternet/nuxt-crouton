// #3620 — the `pi` step's decisions, moved out of work-issue-pidev.yml into scripts/pi-run.mjs.
// Pure refactor, so the contract is "same as before": (R1) the prompt is byte-equal to what the old
// bash built — fixtures/pi-run/old-step.sh is L570-L617 of the step copied VERBATIM at 09d27c55 (the
// owner-screen line #3691 included), and golden.json was captured by running it; (R2) the
// $GITHUB_OUTPUT lines are unchanged and a missing pi exit is a failure; (R3) the files the step
// leaves for later steps are unchanged. Every case also runs the frozen bash LIVE next to the CLI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  branchInstr, promptMode, feedbackWho, OWNER_WHO, REVIEWER_WHO, extractDecisions, isFresh,
  planFeedbackAppendix, buildPrompt, healPrompt, stepOutputs,
} from './pi-run.mjs'
import { renderPrompt } from './pipeline-prompt.mjs'
import { isOwnerScreenSource } from './lib/owner-screens.mjs'
import { inlineBlocks, LIMIT } from './workflow-inline-size.mjs'
import { fakeGh } from './fixtures/pi-run/fake-gh.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FX = join(ROOT, 'scripts/fixtures/pi-run')
const CLI = join(ROOT, 'scripts/pi-run.mjs')
const WF = '.github/workflows/work-issue-pidev.yml'
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
// `$RUNNER_TEMP` in a var value is the case's own temp dir `rt` (the worker's question file, #4192).
const expectedPrompt = (g, rt) => renderPrompt(g.agent, Object.fromEntries(Object.entries(g.vars).map(([k, v]) => [k, v.startsWith('@') ? read(v.slice(1)) : rt ? v.replaceAll('$RUNNER_TEMP', rt) : v]))) + g.tail
/** The files with a reader after the step: approved-plan.txt (finish step), feedback.txt in plan mode. */
const handoff = (files, agent) => Object.fromEntries(Object.entries(files).filter(([f]) => f === 'approved-plan.txt' || (f === 'feedback.txt' && agent === 'pi-planner')))
const envFor = (c, rt) => ({ GITHUB_REPOSITORY: REPO, RUNNER_TEMP: rt, ...c.env })

// A `gh` on PATH answering from gh-data.json, for the real CLI and the frozen bash.
const BIN = mkdtempSync(join(tmpdir(), 'pi-run-bin-'))
writeFileSync(join(BIN, 'gh'), `#!/bin/sh\nexec node "${join(FX, 'fake-gh.mjs')}" "$@"\n`)
chmodSync(join(BIN, 'gh'), 0o755)
function procEnv(c, rt, extra = {}) {
  return { PATH: `${BIN}:${process.env.PATH}`, HOME: process.env.HOME || '/tmp', RUNNER_TEMP: rt, GITHUB_REPOSITORY: REPO, FAKE_GH_DATA: join(FX, 'gh-data.json'), ...(c.fail ? { FAKE_GH_FAIL: c.fail } : {}), ...c.env, ...extra }
}
const runCli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, env, encoding: 'utf8' })

// The frozen bash calls two CLI modes the real scripts no longer have (`owner-screens.mjs --is-source`,
// `plan-held.mjs --approved-prompt` — pi-run.mjs calls their functions directly). So it runs in a
// scratch tree: the removed CLI code from fixtures/pi-run/old-cli/ at those two paths, a copy of
// pipeline-prompt.mjs and best-plan.jq, and .claude linked to the real one.
const OLD_ROOT = mkdtempSync(join(tmpdir(), 'pi-run-old-'))
mkdirSync(join(OLD_ROOT, 'scripts/lib'), { recursive: true })
symlinkSync(join(ROOT, '.claude'), join(OLD_ROOT, '.claude'))
copyFileSync(join(ROOT, 'scripts/pipeline-prompt.mjs'), join(OLD_ROOT, 'scripts/pipeline-prompt.mjs'))
copyFileSync(join(ROOT, 'scripts/lib/best-plan.jq'), join(OLD_ROOT, 'scripts/lib/best-plan.jq'))
copyFileSync(join(FX, 'old-cli/plan-held.mjs'), join(OLD_ROOT, 'scripts/plan-held.mjs'))
copyFileSync(join(FX, 'old-cli/owner-screens.mjs'), join(OLD_ROOT, 'scripts/lib/owner-screens.mjs'))
const REAL_SCRIPTS = pathToFileURL(join(ROOT, 'scripts/')).href

test('branchInstr: main by default, the integration branch when set', () => {
  assert.equal(branchInstr(''), 'branch off main and target the PR at main')
  assert.equal(branchInstr(undefined), 'branch off main and target the PR at main')
  assert.equal(branchInstr('epic/1--x'), "branch off the integration branch 'epic/1--x' and target the PR THERE (not main)")
})

test('promptMode: plan wins over revise, conflict only for exactly "1", else worker', () => {
  assert.equal(promptMode({ plan: '1', revise: '1', conflict: '1' }), 'pi-planner')
  assert.equal(promptMode({ revise: '1', conflict: '1' }), 'pi-conflict-resolver')
  assert.equal(promptMode({ revise: '1', conflict: '' }), 'pi-reviser')
  assert.equal(promptMode({ revise: '1', conflict: 'true' }), 'pi-reviser')
  assert.equal(promptMode({ conflict: '1' }), 'pi-worker')
  assert.equal(promptMode({}), 'pi-worker')
})

test('feedbackWho: Bot → reviewer; User and a failed read ("") → OWNER; owner-screen 🎯 via nuxt-harness → OWNER', () => {
  const body = '🎯 preview feedback: the button sits off-screen on a phone\n'
  assert.equal(feedbackWho({ userType: 'Bot', body: 'review\n', appSlug: '' }, isOwnerScreenSource), REVIEWER_WHO)
  assert.equal(feedbackWho({ userType: 'User', body: 'hi\n', appSlug: '' }, isOwnerScreenSource), OWNER_WHO)
  assert.equal(feedbackWho({ userType: '', body: 'hi\n', appSlug: '' }, isOwnerScreenSource), OWNER_WHO)
  assert.equal(feedbackWho({ userType: 'Bot', body, appSlug: 'nuxt-harness' }, isOwnerScreenSource), OWNER_WHO)
  assert.equal(feedbackWho({ userType: 'Bot', body, appSlug: 'other-app' }, isOwnerScreenSource), REVIEWER_WHO)
  assert.equal(feedbackWho({ userType: 'Bot', body, appSlug: '' }, isOwnerScreenSource), REVIEWER_WHO)
  // the CLI it replaces exited 1 (→ reviewer) when the check could not run; a throw does the same
  assert.equal(feedbackWho({ userType: 'Bot', body }, () => { throw new Error('x') }), REVIEWER_WHO)
})

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
test('extractDecisions matches the awk it replaces (with and without a trailing newline, blank lines)', () => {
  for (const body of [`${ghData.issues['2'].body}\n`, ghData.issues['2'].body, '## Decisions\n\n- a\n\n', '## Decisions\n- a\n## Decisions\n- b']) {
    const awk = spawnSync('awk', ['/^## Decisions[ \\t]*$/{f=1;print;next} /^## /{f=0} f'], { input: body, encoding: 'utf8' })
    assert.equal(awk.status, 0)
    assert.equal(extractDecisions(body), awk.stdout, JSON.stringify(body))
  }
})

test('isFresh: case-insensitive, in the feedback or in the decisions', () => {
  assert.equal(isFresh('Let us START Fresh.\n', ''), true)
  assert.equal(isFresh('ok\n', '## Decisions\n- 2026-11-01 start fresh on the plan\n'), true)
  assert.equal(isFresh('ok\n', '## Decisions\n- keep it\n'), false)
  assert.equal(isFresh('', ''), false)
})

test('planFeedbackAppendix: the three shapes equal the captured bash output', () => {
  const fb101 = `${ghData.comments['101'].body}\n`
  const prev = '<!-- pipeline-plan:v1 -->\n### Fix\nplan one\n\n'
  const dec = extractDecisions(`${ghData.issues['2'].body}\n`)
  const fb103 = `${ghData.comments['103'].body}\n`
  assert.equal(planFeedbackAppendix({ who: OWNER_WHO, feedback: fb103, fresh: true, prevPlan: prev, decisions: '' }), golden['plan-fresh'].tail)
  assert.equal(planFeedbackAppendix({ who: REVIEWER_WHO, feedback: fb101, fresh: false, prevPlan: prev, decisions: '' }), golden['plan-bot'].tail)
  assert.equal(planFeedbackAppendix({ who: REVIEWER_WHO, feedback: fb101, fresh: false, prevPlan: prev, decisions: dec }), golden['plan-decisions'].tail)
  assert.equal(planFeedbackAppendix({ who: REVIEWER_WHO, feedback: fb101, fresh: false, prevPlan: '', decisions: dec }), golden['fail-prev-plan'].tail)
})

// Every case (incl. the tolerated failures), byte-equal to the golden captured from old-step.sh.
for (const [name, c] of Object.entries(cases)) {
  if (c.throws) continue
  test(`buildPrompt [${name}] is byte-equal to the old bash and leaves the same hand-off files`, async () => {
    const rt = runnerTemp(c)
    const out = await buildPrompt(envFor(c, rt), { gh: fakeGh(ghData, c.fail) })
    const g = golden[name]
    assert.equal(out, expectedPrompt(g, rt))
    assert.deepEqual(handoff(filesIn(rt), g.agent), g.files)
  })
}

// covers: T8
test('buildPrompt [worker cases] tells the worker to write its question to <RUNNER_TEMP>/worker-question.md (#4192)', async () => {
  for (const name of ['worker', 'worker-epic', 'worker-approved']) {
    const c = cases[name]
    const rt = runnerTemp(c)
    const out = await buildPrompt(envFor(c, rt), { gh: fakeGh(ghData, c.fail) })
    assert.ok(out.includes(join(rt, 'worker-question.md')), name)
    assert.ok(!out.includes('{{question_file}}'), name)
  }
  assert.ok(!golden['worker-approved'].tail.includes('post a top-level issue comment'))
})

test('the golden owner-screen case really carries the OWNER wording, the other-app case the reviewer wording', () => {
  assert.ok(golden['plan-owner-screen'].tail.includes(`SENT BACK (${OWNER_WHO})`))
  assert.ok(golden['plan-other-app'].tail.includes(`SENT BACK (${REVIEWER_WHO})`))
  assert.ok(golden['fail-user-type'].tail.includes(`SENT BACK (${OWNER_WHO})`))
  assert.ok(golden['fail-app-slug'].tail.includes(`SENT BACK (${REVIEWER_WHO})`))
})

test('buildPrompt [worker-approved] appends the plan-held section', async () => {
  const c = cases['worker-approved']
  const out = await buildPrompt(envFor(c, runnerTemp(c)), { gh: fakeGh(ghData) })
  assert.match(out, /AN INDEPENDENT REVIEWER APPROVED THIS PLAN \(comment 200, #2757\)/)
  assert.ok(out.endsWith(`--- APPROVED PLAN ---\n${ghData.comments['200'].body}\n`))
})

test('buildPrompt throws when the feedback fetch fails', async () => {
  const c = cases['fail-feedback']
  await assert.rejects(buildPrompt(envFor(c, runnerTemp(c)), { gh: fakeGh(ghData, c.fail) }), /forced failure/)
})
test('buildPrompt throws when the approved-plan fetch fails', async () => {
  const c = cases['fail-approved']
  await assert.rejects(buildPrompt(envFor(c, runnerTemp(c)), { gh: fakeGh(ghData, c.fail) }), /forced failure/)
})
test('buildPrompt throws on a persona render error (a missing conflict-task.txt input)', async () => {
  const c = cases.conflict
  await assert.rejects(buildPrompt(envFor(c, runnerTemp({ feedback: true })), { gh: fakeGh(ghData) }), /conflict-task\.txt/)
})
test('buildPrompt throws when renderPrompt or approvedPromptSection throws', async () => {
  const boom = () => { throw new Error('render broke') }
  await assert.rejects(buildPrompt(envFor(cases.worker, runnerTemp(cases.worker)), { gh: fakeGh(ghData), renderPrompt: boom }), /render broke/)
  const c = cases['worker-approved']
  // approvedPromptSection reads the plan back from the hand-off file; a failing read throws through it
  await assert.rejects(buildPrompt(envFor(c, runnerTemp(c)), { gh: fakeGh(ghData), readFile: () => { throw new Error('plan file gone') } }), /plan file gone/)
})
test('buildPrompt falls back to empty when the jq best-plan pipeline fails', async () => {
  const c = cases['plan-bot']
  const out = await buildPrompt(envFor(c, runnerTemp(c)), { gh: fakeGh(ghData), jqBestPlan: () => { throw new Error('jq broke') } })
  assert.ok(!out.includes('PREVIOUS PLAN (revise this)'))
})

test('healPrompt: the old header, then the errors', () => {
  const p = healPrompt('E1')
  assert.ok(p.startsWith('The Vue file(s) you just edited DO NOT COMPILE.'))
  assert.ok(p.endsWith('The exact errors:\n\nE1'))
})
test('healPrompt equals the old printf + cat', () => {
  const rt = mkdtempSync(join(tmpdir(), 'pi-run-heal-old-'))
  writeFileSync(join(rt, 'errs.txt'), 'a.vue: unclosed <div>\n')
  const old = spawnSync('bash', ['-c', `printf 'The Vue file(s) you just edited DO NOT COMPILE. This is a BROKEN build, not a typecheck nitpick — fix ONLY these compile errors and change nothing else. Most are an unbalanced/unclosed tag: every <tag> you opened needs its matching close. Do NOT run git commit and do NOT open a PR. The exact errors:\\n\\n'; cat "${join(rt, 'errs.txt')}"`], { encoding: 'utf8' })
  assert.equal(healPrompt('a.vue: unclosed <div>\n'), old.stdout)
})

// The clear-fail case for "pi never ran" (#3620): no rc → failure, never success.
test('stepOutputs: success only for rc 0; 1, empty, missing or non-numeric is a failure', () => {
  assert.equal(stepOutputs({ rc: 0, start: 100, end: 160, log: 'x.log' }), 'wall=60\nconclusion=success\nexec_log=x.log\n')
  assert.equal(stepOutputs({ rc: '0', start: '1', end: '3', log: 'l' }), 'wall=2\nconclusion=success\nexec_log=l\n')
  for (const rc of [1, '1', '', undefined, 'abc']) {
    assert.match(stepOutputs({ rc, start: 0, end: 0, log: 'l' }), /^conclusion=failure$/m, String(rc))
  }
})

test('CLI prompt prints the prompt; a throw exits non-zero (the step fails under bash -e)', () => {
  const okRt = runnerTemp(cases.worker)
  const ok = runCli(['prompt'], procEnv(cases.worker, okRt))
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stdout, expectedPrompt(golden.worker, okRt))
  const bad = runCli(['prompt'], procEnv(cases['fail-approved'], runnerTemp(cases['fail-approved'])))
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /pi-run:/)
  assert.equal(runCli(['nope'], process.env).status, 2)
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
  writeFileSync(join(rt, 'errs.txt'), 'E\n')
  const h = spawnSync(process.execPath, [join(rt, 'pi-run.mjs'), 'heal', join(rt, 'errs.txt')], { encoding: 'utf8' })
  assert.equal(h.status, 0, h.stderr)
  assert.equal(h.stdout, healPrompt('E\n'))
})

test('CLI hand-off: approved-plan.txt is byte-equal to the fetched body + one newline', () => {
  const c = cases['worker-approved']
  const rt = runnerTemp(c)
  assert.equal(runCli(['prompt'], procEnv(c, rt)).status, 0)
  assert.equal(readFileSync(join(rt, 'approved-plan.txt'), 'utf8'), `${ghData.comments['200'].body}\n`)
})
test('CLI hand-off: no APPROVED_PLAN_ID → approved-plan.txt is not created', () => {
  const rt = runnerTemp(cases.worker)
  assert.equal(runCli(['prompt'], procEnv(cases.worker, rt)).status, 0)
  assert.equal(existsSync(join(rt, 'approved-plan.txt')), false)
})

// The live side-by-side: today's bash (verbatim) and the CLI, same fake gh, same inputs.
for (const [name, c] of Object.entries(cases)) {
  test(`CLI [${name}] matches a live run of the frozen old bash (prompt, hand-off files, exit)`, () => {
    const rtOld = runnerTemp(c)
    const old = spawnSync('bash', ['-euo', 'pipefail', join(FX, 'old-step.sh')], { cwd: OLD_ROOT, env: procEnv(c, rtOld, { PROMPT_FILE: join(rtOld, 'PROMPT'), REAL_SCRIPTS }), encoding: 'utf8' })
    const rtNew = runnerTemp(c)
    const neu = runCli(['prompt'], procEnv(c, rtNew))
    if (c.throws) {
      assert.notEqual(old.status, 0, 'the old bash failed this case')
      assert.notEqual(neu.status, 0, neu.stdout)
      return
    }
    assert.equal(old.status, 0, old.stderr)
    assert.equal(neu.status, 0, neu.stderr)
    // Each side has its own temp dir, and the worker prompt names a file in it (#4192).
    assert.equal(neu.stdout.replaceAll(rtNew, '<RT>'), readFileSync(join(rtOld, 'PROMPT'), 'utf8').replaceAll(rtOld, '<RT>'))
    const agent = golden[name].agent
    assert.deepEqual(handoff(filesIn(rtNew), agent), handoff(filesIn(rtOld, ['PROMPT']), agent))
  })
}

test('work-issue-pidev.yml: the pi step calls pi-run.mjs; the hand-off reader is still there; no dropped scratch file is read', () => {
  const wf = readFileSync(join(ROOT, WF), 'utf8')
  for (const dropped of ['approved-section.txt', 'prev-plan.txt', 'decisions.txt']) {
    assert.ok(!wf.includes(`$RUNNER_TEMP/${dropped}`), `${dropped} is read in the workflow but pi-run.mjs keeps it in memory`)
  }
  assert.match(wf, /signoff-surface\.mjs[^\n]*--plan "\$RUNNER_TEMP\/approved-plan\.txt"/)
  assert.match(wf, /node "\$RUNNER_TEMP\/pi-run\/scripts\/pi-run\.mjs" prompt > "\$PROMPT_FILE"/)
  assert.match(wf, /node "\$RUNNER_TEMP\/pi-run\/scripts\/pi-run\.mjs" heal "\$HEAL_ERRS" > "\$HEAL_PROMPT"/)
  assert.match(wf, /node "\$RUNNER_TEMP\/pi-run\/scripts\/pi-run\.mjs" outputs --rc "\$RC" --start "\$START" --end "\$END" --log "\$LOG" >> "\$GITHUB_OUTPUT"/)
  // FINISH_CHECK is read by .pi/extensions/finish-check.ts from pi's env — it stays in the step env
  assert.match(wf, /FINISH_CHECK: \$\{\{ inputs\.mode != 'plan' && '1' \|\| '' \}\}/)
})

test(`the pi › run block is within the ${LIMIT}-line inline limit, and keeps pi | tee + PIPESTATUS in bash`, () => {
  const blocks = inlineBlocks(readFileSync(join(ROOT, WF), 'utf8'), WF)
  const pi = blocks.find((b) => b.key === `${WF} › work-pi › pi › run`)
  assert.ok(pi, 'pi › run block not found')
  assert.ok(pi.lines <= LIMIT, `pi › run is ${pi.lines} lines`)
  const run = readFileSync(join(ROOT, WF), 'utf8').split('\n').slice(pi.line, pi.line + pi.lines).join('\n')
  assert.match(run, /set \+e\n\s+pi --print[^\n]*\\\n\s+< "\$PROMPT_FILE" 2>&1 \| tee "\$LOG"\n\s+RC=\$\{PIPESTATUS\[0\]\}\n\s+set -e/)
  assert.doesNotMatch(run, /tee "\$LOG" \|\| true/)
})

// Rule: a revise round works on a branch that has no scripts/pi-run.mjs. The revise step checks out
// the PR branch BEFORE the pi step, so the pi step may only run code the baseline step copied aside.
const piRunBlock = () => {
  const wf = readFileSync(join(ROOT, WF), 'utf8')
  const pi = inlineBlocks(wf, WF).find((b) => b.key === `${WF} › work-pi › pi › run`)
  return wf.split('\n').slice(pi.line, pi.line + pi.lines).join('\n')
}
const COPY_LINE = () => readFileSync(join(ROOT, WF), 'utf8').split('\n').find((l) => l.includes('cp -r scripts "$RUNNER_TEMP/pi-run/scripts"'))

test('work-issue-pidev.yml pin: the pi step runs no working-tree scripts/pi-run.mjs; all three calls use the copy', () => {
  const run = piRunBlock()
  assert.doesNotMatch(run, /node scripts\/pi-run\.mjs/)
  const calls = [...run.matchAll(/node (\S*pi-run\.mjs"?) (\w+)/g)].map(([, path, mode]) => [path, mode])
  assert.deepEqual(calls, [['"$RUNNER_TEMP/pi-run/scripts/pi-run.mjs"', 'prompt'], ['"$RUNNER_TEMP/pi-run/scripts/pi-run.mjs"', 'heal'], ['"$RUNNER_TEMP/pi-run/scripts/pi-run.mjs"', 'outputs']])
  // the copy is made in the baseline step, which runs before the revise step's checkout
  const wf = readFileSync(join(ROOT, WF), 'utf8')
  assert.ok(COPY_LINE(), 'the baseline step copies scripts/ to $RUNNER_TEMP/pi-run')
  assert.ok(wf.indexOf(COPY_LINE()) < wf.indexOf('git checkout -f -B "${REV_BRANCH}"'), 'the copy is taken before the revise checkout')
})

test('a revise round works on a branch with no scripts/pi-run.mjs: the copy, run from a tree without scripts/, gives the golden prompts', () => {
  // A workspace as the baseline step sees it (scripts/ + .claude), copied aside with the workflow's own line…
  const ws = mkdtempSync(join(tmpdir(), 'pi-run-ws-'))
  const rt = mkdtempSync(join(tmpdir(), 'pi-run-rtc-'))
  spawnSync('cp', ['-r', join(ROOT, 'scripts'), join(ws, 'scripts')])
  symlinkSync(join(ROOT, '.claude'), join(ws, '.claude'))
  const copy = spawnSync('bash', ['-euo', 'pipefail', '-c', COPY_LINE().trim()], { cwd: ws, env: { ...process.env, RUNNER_TEMP: rt }, encoding: 'utf8' })
  assert.equal(copy.status, 0, copy.stderr)
  // …then the "old PR branch" checkout: no scripts/pi-run.mjs, no neighbours.
  rmSync(join(ws, 'scripts'), { recursive: true, force: true })
  assert.equal(existsSync(join(ws, 'scripts/pi-run.mjs')), false)
  const copied = join(rt, 'pi-run/scripts/pi-run.mjs')
  for (const [name, c] of Object.entries(cases)) {
    if (c.throws) continue
    const crt = runnerTemp(c)
    const r = spawnSync(process.execPath, [copied, 'prompt'], { cwd: ws, env: procEnv(c, crt), encoding: 'utf8' })
    assert.equal(r.status, 0, `${name}: ${r.stderr}`)
    assert.equal(r.stdout, expectedPrompt(golden[name], crt), name)
    assert.deepEqual(handoff(filesIn(crt), golden[name].agent), golden[name].files, name)
  }
})

test('the optional plan-feedback reads log one stderr line when they fall back (no behaviour change)', () => {
  const c = cases['fail-decisions']
  const r = runCli(['prompt'], procEnv(c, runnerTemp(c)))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, expectedPrompt(golden['fail-decisions']))
  assert.match(r.stderr, /^pi-run: ticket Decisions read failed, using empty: .+$/m)
})
