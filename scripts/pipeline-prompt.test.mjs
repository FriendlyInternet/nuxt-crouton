/**
 * #2431 — the pi personas live in .claude/agents/ and are rendered by pipeline-prompt.mjs.
 * Goldens = what the workflows' printf chains produced on main just before the switch, for the
 * same inputs, MINUS the shared operating contract (so editing the contract doesn't break them).
 *
 *   node --test scripts/pipeline-prompt.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { renderPrompt } from './pipeline-prompt.mjs'

const fx = (n) => readFileSync(new URL(`./fixtures/pipeline-prompt/${n}`, import.meta.url), 'utf8')
const contract = readFileSync(new URL('../.claude/agents/pi-operating-contract.md', import.meta.url), 'utf8')

function assertGolden(out, name) {
  assert.ok(out.startsWith(contract), 'every persona starts with the shared operating contract')
  assert.equal(out.slice(contract.length), fx(`${name}.golden.txt`))
}

test('pi-worker, off main', () => {
  assertGolden(renderPrompt('pi-worker', {
    issue: '1932', branch_instr: 'branch off main and target the PR at main', question_file: '/tmp/rt/worker-question.md',
  }), 'pi-worker')
})

test('pi-worker, off an epic branch', () => {
  assertGolden(renderPrompt('pi-worker', {
    issue: '1932', branch_instr: "branch off the integration branch 'epic/9-x' and target the PR THERE (not main)", question_file: '/tmp/rt/worker-question.md',
  }), 'pi-worker-epic')
})

// covers: T7
test('#4192 the worker writes its question to {{question_file}} instead of posting it', () => {
  const out = renderPrompt('pi-worker', { issue: '1', branch_instr: 'branch off main', question_file: '/tmp/rt/worker-question.md' })
  assert.ok(out.includes('write it with the write tool to /tmp/rt/worker-question.md'))
  assert.ok(!out.includes('post a top-level comment on the issue explaining the blocker'))
  assert.throws(() => renderPrompt('pi-worker', { issue: '1', branch_instr: 'x' }), /missing --var question_file/)
})

test('pi-reviser passes the owner comment through verbatim (backticks, %s, {{…}}, trailing blank lines)', () => {
  assertGolden(renderPrompt('pi-reviser', { pr: '77', issue: '1932', feedback: fx('feedback.txt') }), 'pi-reviser')
})

test('pi-conflict-resolver, epic PR (#3002)', () => {
  const task = 'RESOLVE THE MERGE CONFLICT with origin/main. Write the choice file if needed.'
  const out = renderPrompt('pi-conflict-resolver', { pr: '2989', branch: 'epic/227-x', issue: '227', task, feedback: fx('feedback.txt') })
  assertGolden(out, 'pi-conflict-resolver')
  assert.ok(out.includes('RESOLVE THE MERGE CONFLICT'))
  assert.ok(out.includes('epic/227-x'))
  assert.ok(!out.split('VISUAL EVIDENCE')[0].includes('work-227'))
  assert.ok(!out.includes('QUESTION'))
  assert.ok(!/issue body/i.test(out))
  // #3775: the owner's request runs after the merge (pi-request step), so it can't land inside it.
  assert.ok(!out.includes('Please rename `foo`'), 'the resolver prompt does not carry the owner comment')
  assert.ok(out.includes('Resolve the conflict and nothing else'))
  // #4320: migrations are regenerated, never typed into
  assert.ok(out.includes('MIGRATION FILES ARE NEVER HAND-MERGED'))
  assert.ok(out.includes('db:generate'))
})

// covers: T7
test('#4487 the resolver persona builds the packages before db:generate in its migration paragraph', () => {
  const out = renderPrompt('pi-conflict-resolver', { pr: '1', branch: 'b', issue: '1', task: 'x', feedback: 'x' })
  const para = out.split('\n').find((l) => l.startsWith('MIGRATION FILES ARE NEVER HAND-MERGED'))
  assert.ok(para, 'migration paragraph present')
  assert.ok(para.includes('build:packages'), para)
  assert.ok(para.indexOf('build:packages') < para.indexOf('db:generate'), 'build comes before db:generate')
  assert.ok(para.includes('does not list'))
  assert.ok(!para.includes("after the base's last journal entry"))
})

test('pi-conflict-resolver without a task is a hard error', () => {
  assert.throws(() => renderPrompt('pi-conflict-resolver', { pr: '1', branch: 'b', issue: '1', feedback: 'x' }), /missing --var task/)
})

test('pi-decomposer (+ shared dedup rule)', () => {
  assertGolden(renderPrompt('pi-decomposer', { issue: '1932', epic_src: '' }), 'pi-decomposer')
})

// #3846: the decomposer grades ticket claims against a read-only epic-branch checkout; the path
// comes from scripts/epic-checkout.mjs (blank for a brand-new epic → the main checkout).
test('pi-decomposer names the epic-branch checkout it grades against (#3846)', () => {
  const blank = renderPrompt('pi-decomposer', { issue: '1932', epic_src: '' })
  const set = renderPrompt('pi-decomposer', { issue: '1932', epic_src: '/tmp/x' })
  assert.ok(set.includes('EPIC BRANCH CHECKOUT (read-only): `/tmp/x`'))
  assert.match(blank, /path is empty, the epic has no branch yet and the current checkout \(main\) is its code/)
  assert.ok(set.includes('ROLLING SPLIT'))
  assert.throws(() => renderPrompt('pi-decomposer', { issue: '1' }), /missing --var epic_src/)
})

test('the decomposer workflow passes epic_src and has no step input (#3846: later tickets are written by hand)', () => {
  const wf = readFileSync(new URL('../.github/workflows/decompose-on-issue-pidev.yml', import.meta.url), 'utf8')
  assert.match(wf, /pipeline-prompt\.mjs pi-decomposer --var "issue=\$ISSUE" --var "epic_src=\$\(node scripts\/epic-checkout\.mjs --epic "\$ISSUE" --dest "\$RUNNER_TEMP\/epic-src"\)"/)
  const inputs = wf.slice(wf.indexOf('workflow_dispatch:'), wf.indexOf('\njobs:'))
  assert.doesNotMatch(inputs, /^\s+step:/m)
  assert.ok(!wf.includes('step=next'))
  assert.ok(!/replan/i.test(wf))
})

// covers: T1
test('plain test-step rule is in the skill and every step-writing prompt, same wording (#3301)', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const shared = 'PLAIN TEST STEPS (#3301, github-tasks § How to test → Plain steps): each step is one action + `→ what you should see` on the next line; start from the preview URL and name any login or data; only needs what the preview has (the change seeds it, or the step says how to make it in the app); no repo jargon (file/script names, CLI commands, internal terms) unless explained in ≤3 plain words; no owner homework off the phone (scripts, Mac, terminal) — if it can\'t be tested on the preview, say so in one line.'
  const agents = {
    'pi-decomposer (rendered)': renderPrompt('pi-decomposer', { issue: '1', epic_src: '' }),
    'task-decomposer.md': read('../.claude/agents/task-decomposer.md'),
    'task-worker.md': read('../.claude/agents/task-worker.md'),
  }
  const texts = { 'github-tasks SKILL.md': read('../.claude/skills/github-tasks/SKILL.md'), ...agents }
  const phrases = ['one action', 'what you should see', 'preview url', 'only needs what the preview has', 'no repo jargon', '≤3 plain words', 'no owner homework off the phone']
  for (const [name, text] of Object.entries(texts)) {
    const lower = text.toLowerCase()
    for (const p of phrases) assert.ok(lower.includes(p), `${name} is missing "${p}"`)
  }
  for (const [name, text] of Object.entries(agents)) assert.ok(text.includes(shared), `${name} carries the exact shared line`)
})

test('pi-planner (plan mode, #2755)', () => {
  assertGolden(renderPrompt('pi-planner', { issue: '1932' }), 'pi-planner')
})

test('a missing variable is a hard error, not an empty string', () => {
  assert.throws(() => renderPrompt('pi-worker', { issue: '1' }), /missing --var branch_instr/)
})

test('pi-worker reuse search finds an existing helper (#3073)', () => {
  const out = renderPrompt('pi-worker', { issue: '1', branch_instr: 'branch off main', question_file: '/tmp/rt/worker-question.md' })
  assert.ok(out.includes('REUSE BEFORE YOU WRITE'))
  assert.ok(out.includes('Maintaining AI Documentation'))
  const cmd = out.match(/`(grep -rniE '<verb\|noun>'[^`]*)`/)[1].replace('<verb|noun>', 'redirect')
  const root = new URL('..', import.meta.url).pathname
  const found = execFileSync('bash', ['-c', cmd], { cwd: root, encoding: 'utf8' })
  assert.ok(found.includes('sanitizeRedirectUrl'))
})
