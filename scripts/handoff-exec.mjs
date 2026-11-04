#!/usr/bin/env node
// Runs ONE pipeline hand-off step (#3306): its reads + the dispatch / stage label. If GitHub answers
// with the API limit or a 5xx, the step is saved as a `handoff-pending` comment + `handoff:pending`
// label and the run ends green; scripts/handoff-sweep.mjs replays it. Anything else rethrows (red).
//   node scripts/handoff-exec.mjs <kind> '<json>'      kinds: dispatch | plan-build | replan | label
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  PENDING_LABEL, classifyHandoffError, handoffMarker, parseHandoff, handoffKey,
  handoffRunTitle, labelHandoffDone, dispatchHandoffDone, automergeRetryStep,
} from './lib/handoff.mjs'
import { deferOrThrow } from './lib/rate-limit.mjs'

const run = promisify(execFile)

export function ghFactory(env = process.env) {
  return async (args, { token } = {}) => {
    try {
      const { stdout } = await run('gh', args, {
        env: { ...env, GH_TOKEN: token || env.GH_TOKEN },
        maxBuffer: 64 * 1024 * 1024,
      })
      return stdout
    } catch (e) {
      e.stderr = String(e.stderr || '')
      throw e
    }
  }
}

export function makeDeps(env = process.env) {
  return {
    gh: ghFactory(env),
    repo: env.GITHUB_REPOSITORY,
    // github-script exposes its `github-token` input as INPUT_GITHUB-TOKEN, so octokit call sites need no extra env.
    tokens: [...new Set([env.GH_TOKEN || env['INPUT_GITHUB-TOKEN'] || env.GITHUB_TOKEN, env.HANDOFF_FALLBACK_TOKEN].filter(Boolean))],
    now: () => Date.now(),
    log: (m) => console.log(m),
  }
}

const lines = (out) => String(out).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
const pageJson = async (d, endpoint, jq) => lines(await d.gh(['api', '--paginate', endpoint, '--jq', jq]))
const floorSec = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString()

// Latest issue comment whose body contains `marker` (empty string when none).
async function lastCommentWith(d, issue, marker) {
  const out = await d.gh(['api', '--paginate', `repos/${d.repo}/issues/${issue}/comments?per_page=100`,
    '--jq', `[.[] | select(.body | test("\\\\A(?:[ \\\\t]*<!--[^\\\\n]*-->[ \\\\t]*\\\\r?\\\\n)*[ \\\\t]*${marker}[ \\\\t]*(\\\\r?\\\\n|\\\\z)"))] | last | .id // empty`])
  return String(out).split('\n').map((s) => s.trim()).filter(Boolean).pop()
}

async function resolvePlain(step, d) {
  // Hand-back (fix-ci): the instruction comment POST is part of the step. First run posts it from
  // postBodyFile; a replay (file gone) reuses the already-posted PR comment (fallbackFeedback).
  if (!step.postBodyFile && !step.fallbackFeedback) return { workflow: step.workflow, inputs: step.inputs || {} }
  let id = step.fallbackFeedback
  if (step.postBodyFile && existsSync(step.postBodyFile)) {
    id = String(await d.gh(['api', `repos/${d.repo}/issues/${step.issue}/comments`, '--method', 'POST', '-F', `body=@${step.postBodyFile}`, '--jq', '.id'])).trim()
  }
  return { workflow: step.workflow, inputs: { ...(step.inputs || {}), feedback: String(id) } }
}

async function resolveRevisePr(step, d) { // PR comment → its worker branch; the pulls.get read is deferrable too
  const { routePrComment } = await import('./revise-route.mjs')
  const pr = JSON.parse(await d.gh(['api', `repos/${d.repo}/pulls/${step.issue}`, '--jq', '{headRef: .head.ref, state}']))
  const r = routePrComment({ pr, comment: {} })
  return { workflow: 'work-issue-pidev.yml', inputs: { issue: String(r.issue), feedback: String(step.feedback), branch: r.branch } }
}

async function resolvePlanBuild(step, d) {
  const id = await lastCommentWith(d, step.issue, '<!-- pipeline-plan:v1 -->')
  if (!id) throw new Error(`plan:approved on #${step.issue} but no plan comment found — nothing to build from`)
  return { workflow: 'work-issue-pidev.yml', inputs: { issue: step.issue, mode: 'build', plan: id } }
}

async function resolveReplan(step, d) {
  const id = await lastCommentWith(d, step.issue, '<!-- plan-review-verdict:no-go -->')
  if (!id) throw new Error(`no no-go review comment found on #${step.issue}`)
  return { workflow: 'work-issue-pidev.yml', inputs: { issue: step.issue, mode: 'plan', feedback: id } }
}

const RESOLVERS = { dispatch: resolvePlain, 'revise-pr': resolveRevisePr, 'plan-build': resolvePlanBuild, replan: resolveReplan }

// Resolve a step to a dispatch (workflow + inputs). Reads happen here, so a limit on a read defers too.
function resolveDispatch(step, d) {
  const fn = RESOLVERS[step.kind]
  if (!fn) throw new Error(`unknown hand-off kind: ${step.kind}`)
  return fn(step, d)
}

const labelEvents = (d, step) =>
  pageJson(d, `repos/${d.repo}/issues/${step.issue}/events?per_page=100`,
    '.[] | {event, created_at, label: {name: .label.name}, actor: {login: .actor.login}}')

// Do the step. check=true (replay): look for the action's own proof first, finish rather than redo.
export async function perform(step, d, { check = false } = {}) {
  return step.kind === 'label' ? performLabel(step, d, check) : performDispatch(step, d, check)
}

const addLabel = (d, step) =>
  d.gh(['api', '-X', 'POST', `repos/${d.repo}/issues/${step.issue}/labels`, '-f', `labels[]=${step.label}`])

async function performLabel(step, d, check) {
  if (!check) { await addLabel(d, step); return 'done' }
  if (labelHandoffDone(await labelEvents(d, step), { label: step.label, since: step.since })) return 'already'
  try {
    await d.gh(['api', '-X', 'DELETE', `repos/${d.repo}/issues/${step.issue}/labels/${encodeURIComponent(step.label)}`])
  } catch (e) {
    if (!/HTTP 404/.test(e.stderr || e.message || '')) throw e // 404 = label wasn't there; anything else is real
  }
  await addLabel(d, step)
  if (!labelHandoffDone(await labelEvents(d, step), { label: step.label, since: step.since })) {
    throw new Error(`label hand-off not confirmed: no 'labeled ${step.label}' event on #${step.issue} after re-adding`)
  }
  return 'done'
}

async function performDispatch(step, d, check) {
  const { workflow, inputs } = await resolveDispatch(step, d)
  if (check) {
    const runs = await pageJson(d, `repos/${d.repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=50`,
      '.workflow_runs[] | {display_title, created_at}')
    if (dispatchHandoffDone(runs, { title: handoffRunTitle(workflow, inputs), since: step.since })) return 'already'
  }
  const args = ['workflow', 'run', workflow, '--repo', d.repo]
  for (const [k, v] of Object.entries(inputs)) if (v !== undefined && v !== null && v !== '') args.push('-f', `${k}=${v}`)
  await d.gh(args)
  return 'done'
}

const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16)
function pendingLine(c) {
  if (c.reason === 'server') return '🔁 GitHub server error (HTTP 5xx), retrying at the next hourly sweep'
  return c.resetAt ? `🔁 GitHub limit reached, retrying after ${hhmm(c.resetAt)} UTC` : '🔁 GitHub limit reached, retrying at the next hourly sweep'
}

export const listMarkers = async (d, issue, token) =>
  (await lines(await d.gh(['api', '--paginate', `repos/${d.repo}/issues/${issue}/comments?per_page=100`, '--jq', '.[] | {id, body}'], { token })))
    .map((c) => ({ id: c.id, step: parseHandoff(c.body) }))
    .filter((c) => c.step)

// Save the step as pending. App token first, then the workflow token; both failing is loud (throws).
export async function recordPending(step, c, d) {
  const since = step.since || floorSec(d.now())
  let lastErr
  for (const token of d.tokens.length ? d.tokens : [undefined]) {
    try {
      const existing = (await listMarkers(d, step.issue, token)).find((m) => handoffKey(m.step) === handoffKey(step))
      const rec = { ...step, since: existing?.step.since || since, reason: c.reason, attempts: (existing?.step.attempts || 0) + (existing ? 1 : 0) }
      const body = `${handoffMarker(rec)}\n${pendingLine(c)}`
      if (existing) await d.gh(['api', '-X', 'PATCH', `repos/${d.repo}/issues/comments/${existing.id}`, '-f', `body=${body}`], { token })
      else await d.gh(['api', '-X', 'POST', `repos/${d.repo}/issues/${step.issue}/comments`, '-f', `body=${body}`], { token })
      await d.gh(['api', '-X', 'POST', `repos/${d.repo}/issues/${step.issue}/labels`, '-f', `labels[]=${PENDING_LABEL}`], { token })
      return rec
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

// First attempt. Limit / 5xx → saved + green; anything else rethrown.
export async function handoffExec(step, d = makeDeps()) {
  step = { ...step, since: floorSec(d.now()) }
  try {
    return { status: await perform(step, d), step }
  } catch (e) {
    const c = classifyHandoffError(e)
    if (c.action !== 'defer') throw e
    await recordPending(step, c, d)
    d.log(`::warning::hand-off ${step.kind} on #${step.issue} deferred (${c.reason}); the hourly sweep replays it`)
    return { status: 'deferred', reason: c.reason, step }
  }
}

// For octokit call sites: run fn(); on limit/5xx record the step and return {deferred:true}.
export async function handoffGuard(step, fn, d = makeDeps()) {
  try {
    return { deferred: false, value: await fn() }
  } catch (e) {
    const c = classifyHandoffError(e)
    if (c.action !== 'defer') throw e
    await recordPending({ ...step, since: floorSec(d.now()) }, c, d)
    d.log(`::warning::hand-off ${step.kind} on #${step.issue} deferred (${c.reason}); the hourly sweep replays it`)
    return { deferred: true, reason: c.reason }
  }
}

// Outer catch of the merge check (#3361): not limit/5xx -> rethrown (red, nothing saved).
// Limit/5xx -> green; with a PR in hand, a retry of the merge check is saved for the sweep.
export async function deferMergeCheck(e, pr, d = makeDeps(), warn = d.log) {
  deferOrThrow(e, warn)
  const c = classifyHandoffError(e)
  if (!pr || c.action !== 'defer') return { recorded: false }
  try { await recordPending({ ...automergeRetryStep(pr), since: floorSec(d.now()) }, c, d); return { recorded: true } }
  catch (re) { warn(`retry not recorded: ${re.message}`); return { recorded: false } }
}

async function main() {
  const [kind, json] = process.argv.slice(2)
  if (!kind || !json) { console.error("usage: handoff-exec.mjs <kind> '<json>'"); process.exit(2) }
  if (kind === 'record') { // for synchronous callers (apply-decompose-plan): {step, reason, resetAt} already failed
    const { step, reason, resetAt } = JSON.parse(json)
    const d = makeDeps()
    await recordPending({ ...step, since: floorSec(d.now()) }, { reason, resetAt }, d)
    console.log(`hand-off ${step.kind} on #${step.issue}: recorded as pending (${reason})`)
    return
  }
  const r = await handoffExec({ kind, ...JSON.parse(json) })
  console.log(`hand-off ${kind}: ${r.status}`)
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`::error::hand-off failed: ${e.stderr || e.message}`); process.exit(1) })
}
