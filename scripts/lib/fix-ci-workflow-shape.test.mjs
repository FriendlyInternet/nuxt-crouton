// The job layout of fix-ci-on-failure.yml (#3668), read as text — no YAML dependency (Node checks
// runs with no install), relying on the repo's uniform 2-space layout: jobs are the 2-space
// `  <name>:` lines under `jobs:`, steps the 6-space `      - ` lines.
//
// The rules held here: (1) the model reviewer runs in a job with NO write credential; (2) only job
// `fix` commits or pushes, behind the one `fixgo` decision, below the review; (3) every
// `steps.<id>.outputs.<x>` / `needs.<job>.outputs.<x>` the workflow reads is declared — a step
// output only exists inside its own job, and a cross-job value only through `outputs:`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const YML = readFileSync(new URL('../../.github/workflows/fix-ci-on-failure.yml', import.meta.url), 'utf8')

/** @returns {Record<string, string>} job name → its text */
export function splitJobs(yml) {
  const lines = yml.split('\n')
  const start = lines.findIndex(l => /^jobs:\s*$/.test(l))
  const jobs = {}
  let name = null
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l)
    if (m) { name = m[1]; jobs[name] = ''; continue }
    if (/^\S/.test(l)) name = null
    if (name) jobs[name] += l + '\n'
  }
  return jobs
}

/** @returns {{ text:string, name:string, id:string, uses:string }[]} */
export function stepsOf(jobText) {
  const out = []
  let cur = null
  let inSteps = false
  for (const l of jobText.split('\n')) {
    if (/^ {4}steps:\s*$/.test(l)) { inSteps = true; continue }
    if (/^ {4}\S/.test(l)) inSteps = false
    if (!inSteps) continue
    if (/^ {6}- /.test(l)) { cur = { text: '' }; out.push(cur) }
    if (cur) cur.text += l + '\n'
  }
  for (const s of out) {
    const field = (k) => (new RegExp(`^ {6}(?:- | {2})${k}:\\s*(.+?)\\s*$`, 'm').exec(s.text) || [])[1] || ''
    s.name = field('name').replace(/^['"]|['"]$/g, '')
    s.id = field('id')
    s.uses = field('uses').replace(/\s*#.*$/, '')
  }
  return out
}

/** The 4-space `<key>:` block of a job, as its lines. */
const blockOf = (jobText, key) => {
  const lines = jobText.split('\n')
  const i = lines.findIndex(l => new RegExp(`^ {4}${key}:`).test(l))
  if (i < 0) return []
  const inline = lines[i].replace(new RegExp(`^ {4}${key}:\\s*`), '')
  if (inline) return [inline]
  const out = []
  for (const l of lines.slice(i + 1)) { if (!/^ {6}/.test(l)) break; out.push(l.trim()) }
  return out
}
export const needsOf = (jobText) => {
  const v = blockOf(jobText, 'needs').join(' ')
  return v.replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean)
}
export const jobOutputs = (jobText) => blockOf(jobText, 'outputs').map(l => l.split(':')[0].trim()).filter(Boolean)

// `uses:` actions whose outputs we read, and what they set. A new one must be added here on purpose.
const ACTION_OUTPUTS = { 'actions/create-github-app-token': ['token'] }

/** The outputs a step sets: setOutput('x' / echo "x=…" >> "$GITHUB_OUTPUT" / an allow-listed action. */
export function stepSets(step) {
  const set = new Set()
  for (const m of step.text.matchAll(/setOutput\(\s*['"]([\w-]+)['"]/g)) set.add(m[1])
  for (const line of step.text.split('\n').filter(l => l.includes('GITHUB_OUTPUT'))) {
    for (const m of line.matchAll(/echo "([\w-]+)=/g)) set.add(m[1])
  }
  const action = step.uses.split('@')[0]
  for (const x of ACTION_OUTPUTS[action] || []) set.add(x)
  return { set, known: !step.uses || action === 'actions/github-script' || action in ACTION_OUTPUTS }
}

/** Every read output that is not declared, as `job: expression — why`. */
export function undeclaredOutputs(yml) {
  const jobs = splitJobs(yml)
  const missing = []
  for (const [job, text] of Object.entries(jobs)) {
    const steps = stepsOf(text)
    for (const m of new Set([...text.matchAll(/steps\.([\w-]+)\.outputs\.([\w-]+)/g)].map(x => x[0]))) {
      const [, id, x] = /steps\.([\w-]+)\.outputs\.([\w-]+)/.exec(m)
      const s = steps.find(st => st.id === id)
      if (!s) { missing.push(`${job}: ${m} — no step with id ${id} in this job`); continue }
      const { set, known } = stepSets(s)
      if (!known) missing.push(`${job}: ${m} — step ${id} uses ${s.uses.split('@')[0]}, outputs unknown (add it to ACTION_OUTPUTS)`)
      else if (!set.has(x)) missing.push(`${job}: ${m} — step ${id} never sets ${x}`)
    }
    const needs = needsOf(text)
    for (const m of new Set([...text.matchAll(/needs\.([\w-]+)\.outputs\.([\w-]+)/g)].map(x => x[0]))) {
      const [, other, x] = /needs\.([\w-]+)\.outputs\.([\w-]+)/.exec(m)
      if (!needs.includes(other)) missing.push(`${job}: ${m} — ${other} is not in this job's needs`)
      else if (!jobs[other] || !jobOutputs(jobs[other]).includes(x)) missing.push(`${job}: ${m} — not declared on ${other}`)
    }
  }
  return missing
}

const jobs = splitJobs(YML)
const step = (job, name) => stepsOf(jobs[job]).find(s => s.name === name)
const indexOf = (job, name) => stepsOf(jobs[job]).findIndex(s => s.name === name)
const ifOf = (s) => (/^ {8}if:\s*(.+)$/m.exec(s?.text || '') || [])[1] || ''

test('the jobs exist: fixbot → review-1 → round-2 → review-2 → fix → record-outcome', () => {
  assert.deepEqual(Object.keys(jobs), ['fixbot', 'review-1', 'round-2', 'review-2', 'fix', 'record-outcome'])
})

test('the reviewer holds no write credential (review-1 and review-2)', () => {
  for (const j of ['review-1', 'review-2']) {
    const t = jobs[j]
    assert.ok(!t.includes('create-github-app-token'), `${j}: no App token step`)
    assert.deepEqual(blockOf(t, 'permissions'), ['contents: read'], `${j}: permissions exactly contents: read`)
    const checkouts = stepsOf(t).filter(s => s.uses.startsWith('actions/checkout'))
    assert.ok(checkouts.length >= 2, `${j}: default branch + head checkouts`)
    for (const c of checkouts) assert.match(c.text, /persist-credentials: false/, `${j}: every checkout drops its credential`)
    for (const bad of ['GH_TOKEN', 'GITHUB_TOKEN', 'github_token', 'github.token', 'app-token']) assert.ok(!t.includes(bad), `${j}: no ${bad}`)
    assert.deepEqual([...new Set([...t.matchAll(/secrets\.(\w+)/g)].map(m => m[1]))], ['CLAUDE_CODE_OAUTH_TOKEN'], `${j}: only the model token`)
    const a = indexOf(j, 'Assert no write credential on disk')
    const r = indexOf(j, 'Review')
    assert.ok(a >= 0 && r >= 0 && a < r, `${j}: the assert step sits above Review`)
    const assertText = step(j, 'Assert no write credential on disk').text
    for (const s of ['_runner_file_commands', 'git-credentials-', 'ghs_']) assert.ok(assertText.includes(s), `${j}: assert greps ${s}`)
    assert.ok(!/continue-on-error/.test(assertText), `${j}: a found credential fails the job (no verdict = reject)`)
    assert.match(step(j, 'Review').text, /pi --print[\s\S]*diagnosis-reviewer\.md|diagnosis-reviewer\.md[\s\S]*pi --print/)
  }
})

// The assert step's own shell, run for real: clean → exit 0; a planted token or credential config → exit 1.
test('the credential assert fails on a planted token or git credential config, passes when clean', () => {
  const body = step('review-1', 'Assert no write credential on disk').text.split('\n')
  const script = body.slice(body.findIndex(l => /^ {8}run: \|/.test(l)) + 1).map(l => l.replace(/^ {10}/, '')).join('\n')
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'cred-assert-'))
    const temp = join(root, 'temp'); mkdirSync(join(temp, '_runner_file_commands'), { recursive: true })
    const ws = join(root, 'ws'); mkdirSync(ws)
    for (const d of [ws, join(ws, 'head')]) { mkdirSync(d, { recursive: true }); execFileSync('git', ['init', '-q', d]) }
    writeFileSync(join(temp, '_runner_file_commands', 'set_output_1'), 'model<<EOF\nclaude-x\nEOF\n')
    return { temp, ws }
  }
  const run = ({ temp, ws }) => spawnSync('bash', ['-c', script], { cwd: ws, env: { ...process.env, RUNNER_TEMP: temp }, encoding: 'utf8' }).status
  assert.equal(run(setup()), 0, 'clean runner passes')
  const tok = setup(); writeFileSync(join(tok.temp, '_runner_file_commands', 'save_state_2'), `token<<EOF\nghs_${'a'.repeat(36)}\nEOF\n`)
  assert.equal(run(tok), 1, 'a ghs_ token left by a step fails the job')
  const cred = setup(); writeFileSync(join(cred.temp, 'git-credentials-1.config'), '[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic eA==\n')
  assert.equal(run(cred), 1, 'a checkout credential file fails the job')
  const inc = setup(); execFileSync('git', ['-C', join(inc.ws, 'head'), 'config', `includeIf.gitdir:${inc.ws}/head/.git.path`, '/x.config'])
  assert.equal(run(inc), 1, 'an includeIf to a credential config fails the job')
})

test('every steps.<id>.outputs.<x> and needs.<job>.outputs.<x> in fix-ci-on-failure.yml is declared', () => {
  const missing = undeclaredOutputs(YML)
  assert.deepEqual(missing, [], `undeclared outputs:\n${missing.join('\n')}`)
})

// The checker itself, on small inline workflows (so a broken checker can't pass the real file).
const mini = (fixbotOutputs, fixSteps, fixNeeds = '[fixbot]') => `name: x
jobs:
  fixbot:
    outputs:
${fixbotOutputs}
    steps:
      - id: gate
        uses: actions/github-script@abc # v9
        with:
          script: |
            core.setOutput('proceed', 'true')
  round-2:
    needs: fixbot
    outputs:
      next1: \${{ steps.route1.outputs.next }}
    steps:
      - name: Route
        id: route1
        run: |
          echo "next=fix" >> "$GITHUB_OUTPUT"
  fix:
    needs: ${fixNeeds}
    if: always() && needs.fixbot.outputs.proceed == 'true'
    steps:
${fixSteps}
`
const MODEL_STEP = `      - name: Resolve model
        id: model
        run: |
          echo "model=x" >> "$GITHUB_OUTPUT"
`
const USE_MODEL = `      - name: Fix attempt
        if: needs.round-2.outputs.next1 == 'fix'
        run: echo \${{ steps.model.outputs.model }}
`
test('checker: a needs.<job>.outputs.<x> the job does not declare is reported', () => {
  const m = undeclaredOutputs(mini('      mode: ${{ steps.gate.outputs.mode }}', MODEL_STEP + USE_MODEL, '[fixbot, round-2]'))
  assert.ok(m.some(x => x.startsWith('fix: needs.fixbot.outputs.proceed') && /not declared on fixbot/.test(x)), m.join('\n'))
  assert.ok(m.some(x => x.startsWith('fixbot: steps.gate.outputs.mode') && /never sets mode/.test(x)), m.join('\n'))
})
test('checker: steps.model.outputs.model in a job with no `id: model` step is reported', () => {
  const m = undeclaredOutputs(mini('      proceed: ${{ steps.gate.outputs.proceed }}', USE_MODEL, '[fixbot, round-2]'))
  assert.deepEqual(m, ['fix: steps.model.outputs.model — no step with id model in this job'])
})
test('checker: needs.round-2.outputs.next1 from a job whose needs lack round-2 is reported', () => {
  const m = undeclaredOutputs(mini('      proceed: ${{ steps.gate.outputs.proceed }}', MODEL_STEP + USE_MODEL, '[fixbot]'))
  assert.deepEqual(m, ["fix: needs.round-2.outputs.next1 — round-2 is not in this job's needs"])
})
test('checker: an unlisted uses: action whose outputs are read is reported; with the declarations → []', () => {
  const odd = `      - id: odd\n        uses: some/action@v1\n      - name: Read\n        run: echo \${{ steps.odd.outputs.x }}\n`
  assert.ok(undeclaredOutputs(mini('      proceed: ${{ steps.gate.outputs.proceed }}', odd)).some(x => /outputs unknown/.test(x)))
  assert.deepEqual(undeclaredOutputs(mini('      proceed: ${{ steps.gate.outputs.proceed }}', MODEL_STEP + USE_MODEL, '[fixbot, round-2]')), [])
})

test('the Review step lives only in review-* jobs: no job with an App token runs the pi reviewer', () => {
  for (const [name, t] of Object.entries(jobs)) {
    if (!t.includes('create-github-app-token')) continue
    assert.ok(!(t.includes('pi --print') && t.includes('diagnosis-reviewer')), `${name} mints the App token and runs the reviewer`)
  }
})

const FIX_STEPS = ['Fix attempt', 'Commit the staged fix', 'Guard and push the fix']
test('Fix attempt, Commit and Guard exist only in job fix; fixbot commits and pushes nothing', () => {
  for (const [name] of Object.entries(jobs)) {
    for (const s of FIX_STEPS) assert.equal(indexOf(name, s) >= 0, name === 'fix', `${s} in ${name}`)
  }
  for (const bad of ['ci-fix-message', 'commit-ci-fix.sh', 'git-push-retry']) assert.ok(!jobs.fixbot.includes(bad), `fixbot mentions ${bad}`)
})

test('job fix waits for every review job and runs only on a proceeding gate', () => {
  for (const n of ['fixbot', 'review-1', 'round-2', 'review-2']) assert.ok(needsOf(jobs.fix).includes(n), `fix needs ${n}`)
  const jobIf = (/^ {4}if:\s*(.+)$/m.exec(jobs.fix) || [])[1] || ''
  assert.match(jobIf, /always\(\)/)
  assert.match(jobIf, /needs\.fixbot\.outputs\.proceed == 'true'/)
})

test('step order: review routes before the fix decision, the decision before any commit', () => {
  const order = ['Head unchanged?', 'Route round 2', 'Decide the fix', 'Bump the attempt counter', 'Resolve model', ...FIX_STEPS]
  const at = order.map(n => indexOf('fix', n))
  assert.ok(at.every(i => i >= 0), `fix steps present: ${JSON.stringify(Object.fromEntries(order.map((n, i) => [n, at[i]])))}`)
  for (let k = 1; k < at.length; k++) assert.ok(at[k] > at[k - 1], `${order[k - 1]} before ${order[k]}`)
  assert.ok(indexOf('fixbot', 'Same failure on base?') < indexOf('fixbot', 'Diagnose the repeat red'))
  assert.ok(indexOf('fixbot', 'Same failure on base?') >= 0)
  assert.ok(indexOf('round-2', 'Resolve model') >= 0 && indexOf('round-2', 'Resolve model') < indexOf('round-2', 'Diagnose round 2'))
})

test('every commit step runs on the one fixgo decision, never on mode alone', () => {
  for (const s of FIX_STEPS) {
    const cond = ifOf(step('fix', s))
    assert.match(cond, /steps\.fixgo\.outputs\.go == 'true'/, s)
    assert.ok(!/mode == 'diagnose'/.test(cond) && !/mode == 'fix'/.test(cond), `${s}: ${cond}`)
  }
  assert.equal(step('fix', 'Decide the fix').id, 'fixgo')
})

test('the gate no longer bumps the counter or posts the gave-up page; the one-page step does', () => {
  const gate = stepsOf(jobs.fixbot).find(s => s.id === 'gate').text
  assert.ok(!/addLabels[^\n]*ci-fix-attempts/.test(gate), 'no counter bump in the gate')
  assert.ok(!gate.includes('gave up after'), 'no gave-up page in the gate')
  assert.match(step('fixbot', 'Page the owner once (gave up)').text, /gaveUpPosted\(/)
  assert.match(ifOf(step('fixbot', 'Page the owner once (gave up)')), /steps\.gate\.outputs\.gave_up == 'true'/)
})
