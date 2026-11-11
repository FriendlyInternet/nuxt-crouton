#!/usr/bin/env node
/**
 * The decisions of work-issue-pidev.yml's `pi` step (#3620) — moved out of the workflow so they
 * can be tested. The step itself keeps only what must be shell: running `pi | tee` and reading
 * PIPESTATUS. Pure refactor: the prompt, the step outputs and the hand-off files are unchanged
 * (scripts/pi-run.test.mjs compares against a frozen copy of the old bash, fixtures/pi-run/old-step.sh).
 *
 *   node scripts/pi-run.mjs prompt > "$PROMPT_FILE"        build pi's prompt from the step env
 *   node "$RUNNER_TEMP/pi-run.mjs" heal <errfile>           the compile self-heal prompt (#2182)
 *   node "$RUNNER_TEMP/pi-run.mjs" outputs --rc N --start S --end E --log L   → $GITHUB_OUTPUT
 *
 * Why the parts are where they are (the rationale that used to sit in the workflow):
 * - The prompt = the persona (.claude/agents/pi-*.md, #2431) rendered by scripts/pipeline-prompt.mjs,
 *   which prepends the ONE operating contract (#1022) verbatim — the same file
 *   decompose-on-issue-pidev.yml `cat`s, so the two flows cannot drift.
 * - Modes: plan (#2755, planner persona; a plan review / owner reply sent it back → #2756 appendix with
 *   the best earlier plan and the ticket's Decisions, #3341) · revise (#2446) · conflict (#3002, the base
 *   merge conflicted) · worker (optionally building from an approved plan, #2757).
 * - HAND-OFF FILE: in approved-plan mode `$RUNNER_TEMP/approved-plan.txt` is written byte-equal to
 *   today's `gh api … --jq .body >` output. The finish step's sign-off decision reads it again
 *   (work-issue-pidev.yml, `signoff-surface.mjs --plan`) to find the plan's "👁 What to look at" line —
 *   if it vanished, that check would quietly fall back to the issue body. Do not drop it.
 *   In plan + feedback mode `$RUNNER_TEMP/feedback.txt` is written from the fetched comment, as before.
 * - Failure rules (same as the bash): a failed fetch of the feedback or the approved plan, a persona
 *   render error or a plan-held error THROWS (exit 1 → the step fails under bash -e). The previous-plan,
 *   Decisions, `user.type` and PR-number reads fall back to empty. An empty `user.type` gives the OWNER
 *   wording, exactly as `!= "Bot"` did.
 * - `heal` and `outputs` run from the $RUNNER_TEMP copy (the baseline step copies it): pi may have
 *   switched to a branch that does not carry scripts/. They therefore import nothing but node builtins;
 *   `prompt` loads its sibling modules with a dynamic import() only.
 * - The step keeps `set +e` / `pi … | tee` / `RC=${PIPESTATUS[0]}` in bash: under GHA's bash -e a failing
 *   pipeline aborts before RC is written, and a trailing `|| true` clobbers PIPESTATUS[0] to 0 (#1299).
 *   Do not wrap `pi` in a shell function for the same reason. `--approve` trusts the project so pi loads
 *   the lean .pi/settings.json CI profile + the completion-enforcer (#1782/#1764); `--session-dir` gives
 *   each run its own session dir ($RUNNER_TEMP/pi-session, read by the finish step) because the shared
 *   ~/.pi/agent/sessions mixes runs on the self-hosted runners (#1764).
 * - Compile self-heal (#2182): the finish gate only typechecks the touched APP, so a packages/-only .vue
 *   that does not parse used to slip through; the step compiles the touched .vue and re-drives pi once.
 * - outputs: conclusion=success ONLY for rc 0 — a missing/non-numeric rc (pi never ran, crashed) is a
 *   failure, so the artifact-gate can name the cause (#1299) instead of "no deliverable". exec_log hands
 *   the plain-text pi log to the artifact-gate.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export function branchInstr(epicBranch) {
  return epicBranch
    ? `branch off the integration branch '${epicBranch}' and target the PR THERE (not main)`
    : 'branch off main and target the PR at main'
}

export function promptMode({ plan, revise, conflict } = {}) {
  if (plan) return 'pi-planner'
  if (revise) return conflict === '1' ? 'pi-conflict-resolver' : 'pi-reviser'
  return 'pi-worker'
}

export const OWNER_WHO = 'the OWNER replied with guidance on a held plan - treat their comment as authoritative direction'
export const REVIEWER_WHO = 'by the plan reviewer'

/** `'Bot'` → the reviewer wording; anything else (incl. '' from a failed read) → the OWNER wording. */
export function feedbackWho(userType) {
  return userType !== 'Bot' ? OWNER_WHO : REVIEWER_WHO
}

/** Port of `awk '/^## Decisions[ \t]*$/{f=1;print;next} /^## /{f=0} f'` — input is the body as gh prints it. */
export function extractDecisions(body = '') {
  const text = String(body)
  if (!text) return ''
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  let f = false
  let out = ''
  for (const line of lines) {
    if (/^## Decisions[ \t]*$/.test(line)) { f = true; out += `${line}\n`; continue }
    if (/^## /.test(line)) f = false
    if (f) out += `${line}\n`
  }
  return out
}

/** `cat feedback decisions | grep -qi 'start fresh'` — the pattern has no newline, so a per-line match = a match on the joined text. */
export function isFresh(feedback = '', decisions = '') {
  return String(feedback + decisions).split('\n').some((l) => /start fresh/i.test(l))
}

/** The plan-sent-back appendix (#2756/#3341), verbatim from the old printf block. */
export function planFeedbackAppendix({ who, feedback = '', fresh = false, prevPlan = '', decisions = '' }) {
  let out = `\n\nYOUR PREVIOUS PLAN WAS SENT BACK (${who}). REVISE the previous plan below: keep every part that passed verbatim, change only what a FAIL or a Decisions line touches, and add a \`### Changes from the previous plan\` section (what changed and why). Fix each FAIL by actually investigating, not by rewording. Add a \`### Ticket re-read\` section (one bullet per item of the ticket For agents and How to test: \`- <item> — Covered: <where>\` or \`— Not covered: <why>\`) and run \`node scripts/lib/plan-shape.mjs --revised <draft>\` before posting:\n\n`
  out += feedback
  if (fresh) out += '\n\nThe feedback says START FRESH: discard the previous plan, write a new one, and check it with `--revised --fresh`.\n'
  else if (prevPlan.length) out += `\n\nPREVIOUS PLAN (revise this):\n\n${prevPlan}`
  if (decisions.length) out += `\n\nTICKET DECISIONS (binding; no change may contradict them):\n\n${decisions}`
  return out
}

/** The compile self-heal prompt (#2182). */
export function healPrompt(errs = '') {
  return `The Vue file(s) you just edited DO NOT COMPILE. This is a BROKEN build, not a typecheck nitpick — fix ONLY these compile errors and change nothing else. Most are an unbalanced/unclosed tag: every <tag> you opened needs its matching close. Do NOT run git commit and do NOT open a PR. The exact errors:\n\n${errs}`
}

/** The step's $GITHUB_OUTPUT lines. success only for rc 0; a missing or non-numeric rc is a failure. */
export function stepOutputs({ rc, start, end, log }) {
  const code = String(rc ?? '').trim()
  const ok = /^-?\d+$/.test(code) && Number(code) === 0
  return `wall=${Number(end) - Number(start)}\nconclusion=${ok ? 'success' : 'failure'}\nexec_log=${log}\n`
}

const stripNl = (s) => String(s).replace(/\n+$/, '')

const defaultGh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 })

/** `jq -s add | jq -r --argjson fb <id> -f scripts/lib/best-plan.jq` over the paginated comments. */
export function defaultJqBestPlan(raw, fb) {
  const merged = execFileSync('jq', ['-s', '-r', '--argjson', 'fb', String(fb), 'add'], { input: raw, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return execFileSync('jq', ['-r', '--argjson', 'fb', String(fb), '-f', join(HERE, 'lib/best-plan.jq')], { input: merged, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const tryOr = (fn, fallback = '') => { try { return fn() } catch { return fallback } }

/**
 * The whole prompt, from the step env. Side effects: writes the hand-off files (see the header).
 * @param {Record<string,string|undefined>} env
 */
export async function buildPrompt(env, { gh = defaultGh, readFile = (p) => readFileSync(p, 'utf8'), writeFile = (p, s) => writeFileSync(p, s), jqBestPlan = defaultJqBestPlan } = {}) {
  const { renderPrompt } = await import('./pipeline-prompt.mjs')
  const repo = env.GITHUB_REPOSITORY
  const issue = env.ISSUE
  const tmp = env.RUNNER_TEMP
  const mode = promptMode({ plan: env.PLAN, revise: env.REVISE, conflict: env.REV_CONFLICT })

  if (mode === 'pi-planner') {
    let out = renderPrompt(mode, { issue })
    const fb = env.FEEDBACK_ID
    if (!fb) return out
    const feedback = gh(['api', `repos/${repo}/issues/comments/${fb}`, '--jq', '.body'])
    writeFile(join(tmp, 'feedback.txt'), feedback)
    const who = feedbackWho(stripNl(tryOr(() => gh(['api', `repos/${repo}/issues/comments/${fb}`, '--jq', '.user.type']))))
    const prevPlan = tryOr(() => jqBestPlan(gh(['api', `repos/${repo}/issues/${issue}/comments`, '--paginate']), fb))
    const decisions = tryOr(() => extractDecisions(gh(['issue', 'view', issue, '--json', 'body', '-q', '.body'])))
    out += planFeedbackAppendix({ who, feedback, fresh: isFresh(feedback, decisions), prevPlan, decisions })
    return out
  }

  if (mode !== 'pi-worker') {
    const branch = env.REV_BRANCH || `work-${issue}`
    const pr = stripNl(tryOr(() => gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '-q', '.[0].number'])))
    const feedback = readFile(join(tmp, 'feedback.txt'))
    if (mode === 'pi-conflict-resolver') {
      return renderPrompt(mode, { pr, issue, branch, task: readFile(join(tmp, 'conflict-task.txt')), feedback })
    }
    return renderPrompt(mode, { pr, issue, feedback })
  }

  let out = renderPrompt(mode, { issue, branch_instr: branchInstr(env.EPIC_BRANCH) })
  const planId = env.APPROVED_PLAN_ID
  if (planId) {
    const planFile = join(tmp, 'approved-plan.txt')
    writeFile(planFile, gh(['api', `repos/${repo}/issues/comments/${planId}`, '--jq', '.body']))
    const { approvedPromptSection } = await import('./plan-held.mjs')
    out += approvedPromptSection({ planId, planText: readFile(planFile), issue, repo, gh })
  }
  return out
}

function flag(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [cmd, ...argv] = process.argv.slice(2)
  try {
    if (cmd === 'prompt') process.stdout.write(await buildPrompt(process.env))
    else if (cmd === 'heal') process.stdout.write(healPrompt(argv[0] ? tryOr(() => readFileSync(argv[0], 'utf8')) : ''))
    else if (cmd === 'outputs') process.stdout.write(stepOutputs({ rc: flag(argv, '--rc'), start: flag(argv, '--start'), end: flag(argv, '--end'), log: flag(argv, '--log') }))
    else { process.stderr.write('usage: pi-run.mjs prompt | heal <errfile> | outputs --rc N --start S --end E --log L\n'); process.exit(2) }
  } catch (e) {
    process.stderr.write(`pi-run: ${e.message}\n`)
    process.exit(1)
  }
}
