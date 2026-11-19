#!/usr/bin/env node
/**
 * plan-checks (#3195, epic #3193) — CI runs the approved plan's `### Test` checklist itself.
 *
 * Rule: for a `work-<N>` PR whose issue has an approved plan, the `plan-checks` job (and so the
 * `CI Gate`) is green only if every `Run:` line of that plan exited 0 on the PR's head commit.
 * A missing or skipped run never counts as passing; a `Manual:` line is shown as 🖐 and not run.
 *
 * Which plan: the newest comment on the issue that carries `<!-- pipeline-plan:v1 -->`, was posted
 * by the pipeline bot, and is followed (before the next plan) by a bot `plan-review-verdict:go`.
 * A plan from anyone else is ignored — a human must not be able to make CI run a pasted command.
 *
 * Three steps, so the plan's commands never run with a write token in their environment:
 *   node plan-checks.mjs fetch  --out <plan.json>                (needs GH_TOKEN, read)
 *   node plan-checks.mjs run    --plan <plan.json> --out <results.json> [--cwd <pr checkout>]
 *   node plan-checks.mjs report --plan <plan.json> --results <results.json>   (GH_TOKEN, PR write)
 * `report` posts/updates ONE sticky `<!-- plan-checks -->` comment and exits 1 on any ❌.
 *
 * This file and the parser are run from a checkout of the DEFAULT branch (ci.yml), so a PR cannot
 * edit what judges it. Only node builtins (bare-node set).
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePlan } from './lib/plan-shape.mjs'

export const BOT = 'nuxt-harness[bot]'
export const STICKY = '<!-- plan-checks -->'
export const TIMEOUT_MS = 10 * 60 * 1000
const lead = (m) => new RegExp(`^(?:[ \\t]*<!--[^\\n]*-->[ \\t]*\\r?\\n)*[ \\t]*${m}[ \\t]*(\\r?\\n|$)`)
const PLAN = lead('<!-- pipeline-plan:v1 -->')
const VERDICT = lead('<!-- plan-review-verdict:([a-z-]+) -->')

/** `work-123` → 123; anything else → null. */
export function issueFromRef(ref) {
  const m = String(ref || '').match(/^work-(\d+)$/)
  return m ? Number(m[1]) : null
}

const byBot = (c) => (c.user?.login || c.author?.login) === BOT

/** PURE. Comments in posting order → the approved plan comment, or null. */
const kindOf = (body = '') => (PLAN.test(body) ? 'plan' : body.match(VERDICT)?.[1] ?? null)

/** Walk forward: a plan waits for the next verdict; a newer plan replaces one still waiting. */
export function findApprovedPlan(comments) {
  let pending = null
  let approved = null
  for (const c of (comments || []).filter(byBot)) {
    const kind = kindOf(c.body || '')
    if (kind === 'plan') pending = c
    else if (kind) {
      if (kind === 'go' && pending) approved = pending
      pending = null
    }
  }
  return approved
}

/** PURE. Decide what this PR is checked against. */
export function decidePlan({ headRef, comments }) {
  const issue = issueFromRef(headRef)
  if (!issue) return { issue: null, items: [], summary: `not a work-* PR (${headRef || 'no PR'}) — nothing to check` }
  const plan = findApprovedPlan(comments)
  if (!plan) return { issue, items: [], summary: `issue #${issue} has no approved plan from ${BOT} — nothing to check` }
  const p = parsePlan(plan.body || '')
  if (!p.checklist.length) {
    return { issue, items: [], planUrl: plan.html_url, error: `approved plan has no readable Test checklist: ${p.errors.join('; ')}` }
  }
  return { issue, items: p.checklist, planUrl: plan.html_url, summary: `${p.checklist.length} check(s) from the approved plan on #${issue}` }
}

const tail = (s, n = 20) => String(s || '').replace(/\s+$/, '').split('\n').slice(-n).join('\n')

/** Real exec: `bash -c cmd` in its own process group, combined output, killed on timeout. */
export function execCommand(cmd, { cwd, timeoutMs = TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve) => {
    let out = ''
    let timedOut = false
    const child = spawn('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const add = (d) => { out += d; if (out.length > 200_000) out = out.slice(-100_000) }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const t = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch {} }, timeoutMs)
    child.on('error', (e) => { clearTimeout(t); resolve({ code: 127, output: `${out}\n${e.message}`, timedOut }) })
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 137, output: out, timedOut }) })
  })
}

/** Run every `Run:` line in order; `Manual:` → 🖐 not run. Never stops early: every row is reported. */
export async function runChecks(items, { exec = execCommand, cwd, timeoutMs = TIMEOUT_MS, env } = {}) {
  const results = []
  for (const it of items) {
    if (it.type !== 'run') { results.push({ ...it, status: 'manual', exit: null, tail: '' }); continue }
    const r = await exec(it.detail, { cwd, timeoutMs, env })
    const t = r.timedOut ? `${tail(r.output, 19)}\ntimeout: killed after ${Math.round(timeoutMs / 1000)}s` : tail(r.output)
    results.push({ ...it, status: !r.timedOut && r.code === 0 ? 'pass' : 'fail', exit: r.timedOut ? 'timeout' : r.code, tail: t })
  }
  return results
}

const ICON = { pass: '✅', fail: '❌', manual: '🖐' }
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** PURE. The sticky comment body. */
export function renderComment({ results, sha, planUrl, error }) {
  const head = `${STICKY}\n> 🤖 **pi.dev harness** · CI \`plan-checks\` · _the approved plan's Test lines, run on ${sha ? `\`${String(sha).slice(0, 7)}\`` : 'the PR head'}_\n`
  if (error) return `${head}\n❌ **Plan checks could not run** — ${error}${planUrl ? ` ([plan](${planUrl}))` : ''}\n`
  const failed = results.filter((r) => r.status === 'fail').length
  const verdict = failed ? `❌ **${failed} plan check(s) failed**` : '✅ **Every plan check passed**'
  const rows = results.map((r) => `| ${r.id} | ${cell(r.what)} | ${ICON[r.status]} | ${r.exit ?? '—'} |`)
  const tails = results.filter((r) => r.status !== 'manual').map((r) =>
    `<details><summary>${r.id} — \`${cell(r.detail)}\` · last 20 lines</summary>\n\n\`\`\`\n${r.tail.replace(/```/g, "'''")}\n\`\`\`\n\n</details>`)
  return [head, `${verdict}${planUrl ? ` · [plan](${planUrl})` : ''}`, '', '| ID | What | Result | Exit |', '|---|---|---|---|', ...rows, '', ...tails, ''].join('\n')
}

/** Exit code for `report`: 1 on any ❌ or a broken plan. */
export const exitCode = ({ results = [], error }) => (error || results.some((r) => r.status === 'fail') ? 1 : 0)

// ---- I/O (gh) ---------------------------------------------------------------------------------
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 << 20 })
const ghJson = (path) => gh(['api', '--paginate', '--slurp', path]).trim()

export function listComments(repo, n, run = ghJson) {
  return JSON.parse(run(`repos/${repo}/issues/${n}/comments?per_page=100`) || '[]').flat()
}

export function upsertSticky(repo, pr, body, { list = listComments, call = gh } = {}) {
  const mine = list(repo, pr).filter((c) => byBot(c) || c.user?.login === 'github-actions[bot]').find((c) => (c.body || '').includes(STICKY))
  const payload = JSON.stringify({ body })
  if (mine) call(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, '--input', '-'], payload)
  else call(['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], payload)
  return mine ? 'updated' : 'created'
}

const arg = (a, k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
const logLine = (s) => { console.log(s); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`) }

const TOKEN_VARS = /^(GH_TOKEN|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN)$/
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))

function fetchStep(argv, { env, comments, say }) {
  const ref = env.HEAD_REF || ''
  const issue = issueFromRef(ref)
  const all = issue ? (comments ?? listComments(env.GITHUB_REPOSITORY, issue)) : []
  const d = { ...decidePlan({ headRef: ref, comments: all }), pr: env.PR_NUMBER || null, sha: env.HEAD_SHA || null }
  d.needsInstall = d.items.some((i) => i.type === 'run')
  writeFileSync(arg(argv, '--out'), JSON.stringify(d, null, 2))
  say(`plan-checks: ${d.error || d.summary}`)
  const hasPlan = Boolean(d.items.length || d.error)
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `has_plan=${hasPlan}\nneeds_install=${d.needsInstall}\n`)
  return 0
}

async function runStep(argv, { env, exec, say }) {
  const plan = readJson(arg(argv, '--plan'))
  // The plan's commands get no token: strip anything that could write back to GitHub.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !TOKEN_VARS.test(k)))
  const cwd = arg(argv, '--cwd') || process.cwd()
  const results = plan.error ? [] : await runChecks(plan.items, { exec, cwd, env: childEnv })
  writeFileSync(arg(argv, '--out'), JSON.stringify(results, null, 2))
  for (const r of results) say(`${ICON[r.status]} ${r.id} ${r.what} (exit ${r.exit ?? '—'})`)
  return 0
}

/** A Run line with no recorded result (the run step died) is a ❌, never a pass. */
export function withMissing(items, results) {
  const seen = new Set(results.map((r) => r.id))
  const missing = items.filter((it) => it.type === 'run' && !seen.has(it.id))
    .map((it) => ({ ...it, status: 'fail', exit: 'not run', tail: 'no result recorded — the run step did not finish' }))
  return [...results, ...missing]
}

function postSticky(env, plan, body, say) {
  if (!plan.pr) return
  try { say(`sticky comment ${upsertSticky(env.GITHUB_REPOSITORY, plan.pr, body)}`) } catch (e) { say(`::warning::could not post the plan-checks comment: ${e.message}`) }
}

function reportStep(argv, { env, say }) {
  const plan = readJson(arg(argv, '--plan'))
  if (!plan.items.length && !plan.error) { say(`plan-checks: ${plan.summary}`); return 0 }
  const results = plan.error ? [] : withMissing(plan.items, readJson(arg(argv, '--results')))
  postSticky(env, plan, renderComment({ results, sha: plan.sha, planUrl: plan.planUrl, error: plan.error }), say)
  const code = exitCode({ results, error: plan.error })
  say(code ? 'plan-checks: FAILED' : 'plan-checks: passed')
  return code
}

const STEPS = { fetch: fetchStep, run: runStep, report: reportStep }

export async function main(argv, { env = process.env, comments, exec, log = logLine } = {}) {
  const step = STEPS[argv[0]]
  if (!step) { console.error('usage: plan-checks.mjs fetch|run|report …'); return 2 }
  return step(argv, { env, comments, exec, say: log })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1) })
}
