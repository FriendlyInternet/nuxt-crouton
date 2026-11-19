#!/usr/bin/env node
/**
 * The decisions of work-issue-pidev.yml's `pi` step (#3620) — moved out of the workflow so they
 * can be tested. The step keeps only what must be shell: running `pi | tee` and reading
 * PIPESTATUS. Pure refactor: the prompt, the step outputs and the hand-off files are unchanged
 * (scripts/pi-run.test.mjs runs a frozen copy of the old bash, fixtures/pi-run/old-step.sh, side by side).
 *
 *   node "$RUNNER_TEMP/pi-run/scripts/pi-run.mjs" prompt > "$PROMPT_FILE"   build pi's prompt from the step env
 *   node "$RUNNER_TEMP/pi-run/scripts/pi-run.mjs" heal <errfile>            the compile self-heal prompt (#2182)
 *   node "$RUNNER_TEMP/pi-run/scripts/pi-run.mjs" outputs --rc N --start S --end E --log L   → $GITHUB_OUTPUT
 *
 * Why the parts are where they are (the rationale that used to sit in the workflow):
 * - The prompt front-loads the CANONICAL operating contract (#1022) so pi does not stall-and-ask
 *   while headless (#839). The persona (.claude/agents/pi-*.md, #2431) is rendered by
 *   scripts/pipeline-prompt.mjs, which prepends .claude/agents/pi-operating-contract.md verbatim —
 *   the same file decompose-on-issue-pidev.yml `cat`s, so the two flows cannot drift — plus
 *   _worker-checks.md (visual evidence #1748, compile self-check #2182). Its golden test pins it.
 * - Modes: plan (#2755, planner persona). A plan review or an owner reply sent it back (#2756):
 *   the appendix carries the comment, the BEST earlier plan (most ✅ in its review, newest on a tie,
 *   scripts/lib/best-plan.jq) and the ticket's Decisions (#3341), so the planner revises instead of
 *   rewriting; "start fresh" in either skips the old plan. A Bot comment that is the owner answering
 *   from one of our screens (owner-screens.mjs, #3691) counts as the owner. · revise (#2446) ·
 *   conflict (#3002 — the base merge conflicted; its own persona, and no feedback: the owner's request
 *   runs in its own pass after the merge, #3775) · worker (the integration branch from the issue's
 *   pipeline block, #1695; optionally building from an approved plan, #2757).
 * - HAND-OFF FILES: in build-from-plan mode `$RUNNER_TEMP/approved-plan.txt` is written byte-equal to
 *   the old `gh api … --jq .body >` output; the finish step reads it again (`signoff-surface.mjs
 *   --plan`) to find the plan's "👁 What to look at" line. In plan + feedback mode `feedback.txt` is
 *   written from the fetched comment. Revise/conflict READ feedback.txt / conflict-task.txt, written by
 *   the revise step.
 * - Failure rules (same as the bash): a failed fetch of the feedback or the approved plan, a persona
 *   render error or a plan-held error THROWS (exit 1 → the step fails under bash -e). The previous-plan,
 *   Decisions, `user.type`, app-slug and PR-number reads fall back to empty. An empty `user.type` gives
 *   the OWNER wording, exactly as `!= "Bot"` did.
 * - All three modes run from the $RUNNER_TEMP/pi-run copy (the baseline step copies scripts/ there and
 *   links $RUNNER_TEMP/pi-run/.claude to the working tree's .claude): the revise step has already
 *   checked out the PR branch, which may predate this file, and pi may switch branches mid-run. The
 *   personas are still read from the working tree, as before. `prompt` loads its sibling modules with
 *   a dynamic import() only, so `heal`/`outputs` also work from a lone copy of this file.
 * - The step keeps `set +e` / `pi … | tee` / `RC=${PIPESTATUS[0]}` in bash: GHA runs `run:` with bash
 *   -e, so a failing pipeline aborts before RC is written and the artifact-gate posts a generic "no
 *   deliverable" (#1299); a trailing `|| true` clobbers PIPESTATUS[0] to 0. Do not wrap `pi` in a
 *   shell function either. `--approve` trusts the project so pi loads the lean .pi/settings.json CI
 *   profile + the completion-enforcer (#1782/#1764); `--session-dir` gives each run its own session
 *   dir ($RUNNER_TEMP/pi-session, read by the finish step) because the shared ~/.pi/agent/sessions
 *   mixes concurrent runs (#1764). Provider pinned + skills via --skill (#888).
 * - Compile self-heal (#2182): the finish gate only typechecks the touched APP, so a packages/-only
 *   .vue that does not parse used to open a PR and fail CI only indirectly (#2179/#2180). The step
 *   compiles the touched .vue and re-drives pi ONCE, same session, with healPrompt().
 * - outputs: conclusion=success ONLY for rc 0 — a missing/non-numeric rc (pi never ran) is a failure.
 *   exec_log hands the plain-text pi log to the artifact-gate so it can classify WHY a run produced
 *   nothing (pi emits no structured execution_file).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIG = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }

export const OWNER_WHO = 'the OWNER replied with guidance on a held plan - treat their comment as authoritative direction'
export const REVIEWER_WHO = 'by the plan reviewer'

export function branchInstr(epicBranch) {
  return epicBranch
    ? `branch off the integration branch '${epicBranch}' and target the PR THERE (not main)`
    : 'branch off main and target the PR at main'
}

/** Plan wins over revise; the conflict resolver only for REV_CONFLICT exactly '1'. */
export function promptMode({ plan, revise, conflict } = {}) {
  if (plan) return 'pi-planner'
  if (!revise) return 'pi-worker'
  return conflict === '1' ? 'pi-conflict-resolver' : 'pi-reviser'
}

const tryOr = (fn, fallback = '') => { try { return fn() } catch { return fallback } }
/** tryOr for the optional plan-feedback reads: same fallback, plus one stderr line saying which read failed. */
const tryOrLog = (what, fn, fallback = '') => {
  try { return fn() } catch (e) {
    process.stderr.write(`pi-run: ${what} failed, using empty: ${String(e?.message ?? e).split('\n')[0]}\n`)
    return fallback
  }
}
const stripNl = (s) => String(s).replace(/\n+$/, '')

/**
 * Who sent the plan back. Not a Bot (incl. '' from a failed read) → the OWNER wording; a Bot comment
 * that is the owner answering from one of our screens (#3691) → the OWNER wording too.
 * `isOwnerScreenSource` is scripts/lib/owner-screens.mjs's, passed in so this file stays import-free.
 */
export function feedbackWho({ userType, body, appSlug }, isOwnerScreenSource) {
  const owner = userType !== 'Bot' || tryOr(() => isOwnerScreenSource({ comment: { body, appSlug: appSlug || null } }), false)
  return owner ? OWNER_WHO : REVIEWER_WHO
}

const DECISIONS_RE = /^## Decisions[ \t]*$/
// awk's `f`: a Decisions header turns it on, any other "## " line turns it off.
const decisionsOn = (f, line) => DECISIONS_RE.test(line) || (f && !/^## /.test(line))

/** Port of `awk '/^## Decisions[ \t]*$/{f=1;print;next} /^## /{f=0} f'` over the body as gh prints it. */
export function extractDecisions(body = '') {
  const lines = String(body).split('\n')
  if (lines.at(-1) === '') lines.pop() // a trailing newline ends the last record, it is not one more
  let f = false
  return lines.reduce((out, line) => {
    f = decisionsOn(f, line)
    return f ? `${out}${line}\n` : out
  }, '')
}

/** `cat feedback decisions | grep -qi 'start fresh'` — the pattern has no newline, so the joined text answers the same. */
export function isFresh(feedback = '', decisions = '') {
  return /start fresh/i.test(`${feedback}${decisions}`)
}

/** The plan-sent-back appendix (#2756/#3341), verbatim from the old printf block. */
export function planFeedbackAppendix({ who, feedback = '', fresh = false, prevPlan = '', decisions = '' }) {
  let out = `\n\nYOUR PREVIOUS PLAN WAS SENT BACK (${who}). REVISE the previous plan below: keep every part that passed verbatim, change only what a FAIL or a Decisions line touches, and add a \`### Changes from the previous plan\` section (what changed and why). Fix each FAIL by actually investigating, not by rewording. Add a \`### Ticket re-read\` section (one bullet per item of the ticket For agents and How to test: \`- <item> — Covered: <where>\` or \`— Not covered: <why>\`) and run \`node scripts/lib/plan-shape.mjs --revised <draft>\` before posting:\n\n${feedback}`
  if (fresh) out += '\n\nThe feedback says START FRESH: discard the previous plan, write a new one, and check it with `--revised --fresh`.\n'
  else if (prevPlan) out += `\n\nPREVIOUS PLAN (revise this):\n\n${prevPlan}`
  if (decisions) out += `\n\nTICKET DECISIONS (binding; no change may contradict them):\n\n${decisions}`
  return out
}

/** The compile self-heal prompt (#2182). */
export function healPrompt(errs = '') {
  return `The Vue file(s) you just edited DO NOT COMPILE. This is a BROKEN build, not a typecheck nitpick — fix ONLY these compile errors and change nothing else. Most are an unbalanced/unclosed tag: every <tag> you opened needs its matching close. Do NOT run git commit and do NOT open a PR. The exact errors:\n\n${errs}`
}

/** The step's $GITHUB_OUTPUT lines. success only for rc 0; a missing, empty or non-numeric rc is a failure. */
export function stepOutputs({ rc, start, end, log }) {
  const code = String(rc ?? '').trim()
  const ok = /^-?\d+$/.test(code) && Number(code) === 0
  return `wall=${Number(end) - Number(start)}\nconclusion=${ok ? 'success' : 'failure'}\nexec_log=${log}\n`
}

const defaultGh = (args) => execFileSync('gh', args, { ...BIG, stdio: ['ignore', 'pipe', 'pipe'] })

/** `jq -s -r --argjson fb <id> add | jq -r --argjson fb <id> -f scripts/lib/best-plan.jq`, as before. */
export function defaultJqBestPlan(raw, fb) {
  const merged = execFileSync('jq', ['-s', '-r', '--argjson', 'fb', String(fb), 'add'], { ...BIG, input: raw })
  return execFileSync('jq', ['-r', '--argjson', 'fb', String(fb), '-f', join(HERE, 'lib/best-plan.jq')], { ...BIG, input: merged })
}

const DEFAULT_IO = {
  gh: defaultGh,
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, s) => writeFileSync(p, s),
  jqBestPlan: defaultJqBestPlan,
}

// bash `A || B`: the app slug is only read (and the module only loaded) when the author is a Bot.
async function whoFor(userType, body, readSlug) {
  if (userType !== 'Bot') return OWNER_WHO
  const { isOwnerScreenSource } = await import('./lib/owner-screens.mjs')
  return feedbackWho({ userType, body, appSlug: readSlug() }, isOwnerScreenSource)
}

async function planFeedback({ io, repo, issue, tmp }, fb) {
  const comment = (jq) => io.gh(['api', `repos/${repo}/issues/comments/${fb}`, '--jq', jq])
  const feedback = comment('.body')
  io.writeFile(join(tmp, 'feedback.txt'), feedback)
  const userType = stripNl(tryOrLog('feedback user.type read', () => comment('.user.type')))
  const who = await whoFor(userType, feedback, () => stripNl(tryOrLog('feedback app-slug read', () => comment('.performed_via_github_app.slug // ""'))))
  const prevPlan = tryOrLog('previous-plan read', () => io.jqBestPlan(io.gh(['api', `repos/${repo}/issues/${issue}/comments`, '--paginate']), fb))
  const decisions = tryOrLog('ticket Decisions read', () => extractDecisions(io.gh(['issue', 'view', issue, '--json', 'body', '-q', '.body'])))
  return planFeedbackAppendix({ who, feedback, fresh: isFresh(feedback, decisions), prevPlan, decisions })
}

async function planPrompt(ctx) {
  const out = ctx.renderPrompt('pi-planner', { issue: ctx.issue })
  const fb = ctx.env.FEEDBACK_ID
  return fb ? out + await planFeedback(ctx, fb) : out
}

function openPr({ io, env, issue }) {
  const branch = env.REV_BRANCH || `work-${issue}`
  const pr = stripNl(tryOr(() => io.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '-q', '.[0].number'])))
  return { pr, branch }
}

// The resolver never sees the owner's comment (#3775): only pr/issue/branch/task.
function conflictPrompt(ctx) {
  const { pr, branch } = openPr(ctx)
  return ctx.renderPrompt('pi-conflict-resolver', { pr, issue: ctx.issue, branch, task: ctx.io.readFile(join(ctx.tmp, 'conflict-task.txt')) })
}

function revisePrompt(ctx) {
  const { pr } = openPr(ctx)
  return ctx.renderPrompt('pi-reviser', { pr, issue: ctx.issue, feedback: ctx.io.readFile(join(ctx.tmp, 'feedback.txt')) })
}

async function approvedSection({ io, repo, issue, tmp }, planId) {
  const planFile = join(tmp, 'approved-plan.txt')
  io.writeFile(planFile, io.gh(['api', `repos/${repo}/issues/comments/${planId}`, '--jq', '.body']))
  const { approvedPromptSection } = await import('./plan-held.mjs')
  return approvedPromptSection({ planId, planText: io.readFile(planFile), issue, repo, gh: io.gh })
}

async function workerPrompt(ctx) {
  const out = ctx.renderPrompt('pi-worker', { issue: ctx.issue, branch_instr: branchInstr(ctx.env.EPIC_BRANCH), question_file: join(ctx.tmp, 'worker-question.md') })
  const planId = ctx.env.APPROVED_PLAN_ID
  return planId ? out + await approvedSection(ctx, planId) : out
}

const BUILDERS = { 'pi-planner': planPrompt, 'pi-conflict-resolver': conflictPrompt, 'pi-reviser': revisePrompt, 'pi-worker': workerPrompt }

/**
 * The whole prompt, from the step env. Side effects: the hand-off files (see the header).
 * @param {Record<string,string|undefined>} env
 * @param {Partial<typeof DEFAULT_IO> & {renderPrompt?: Function}} [deps] renderPrompt defaults to pipeline-prompt.mjs's
 */
export async function buildPrompt(env, deps = {}) {
  const renderPrompt = deps.renderPrompt ?? (await import('./pipeline-prompt.mjs')).renderPrompt
  const ctx = { env, io: { ...DEFAULT_IO, ...deps }, renderPrompt, repo: env.GITHUB_REPOSITORY, issue: env.ISSUE, tmp: env.RUNNER_TEMP }
  return BUILDERS[promptMode({ plan: env.PLAN, revise: env.REVISE, conflict: env.REV_CONFLICT })](ctx)
}

function flag(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const COMMANDS = {
  prompt: () => buildPrompt(process.env),
  heal: ([file]) => healPrompt(file ? tryOr(() => readFileSync(file, 'utf8')) : ''),
  outputs: (argv) => stepOutputs({ rc: flag(argv, '--rc'), start: flag(argv, '--start'), end: flag(argv, '--end'), log: flag(argv, '--log') }),
}

async function main([cmd, ...argv]) {
  const run = COMMANDS[cmd]
  if (!run) {
    process.stderr.write('usage: pi-run.mjs prompt | heal <errfile> | outputs --rc N --start S --end E --log L\n')
    process.exit(2)
  }
  try {
    process.stdout.write(await run(argv))
  } catch (e) {
    process.stderr.write(`pi-run: ${e.message}\n`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main(process.argv.slice(2))
