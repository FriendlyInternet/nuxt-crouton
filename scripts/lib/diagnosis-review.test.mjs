// #3668 diagnosis review loop (+ #3277 counter/one page, #3270 same failure on base). The agreed cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  MAX_REVIEW_ROUNDS, isPipelineBot, reviewMarker, parseReviewMarker, stoppedAtLine, precheck, parseReviewVerdict,
  routeReview, fixGo, approvedDiagnosis, handoffLog, isMiss, missOf, normaliseLine, failureSignature, pickBaseRun,
  baseVerdict, effectiveAttempts, gaveUpMarker, gaveUpPosted, ownerAsk, renderReview, linkedRefs,
  handbackMarker, parseHandbackMarker, carriesCount, carriedTry, firstFailingLines,
} from './diagnosis-review.mjs'
import { diagnosisMarker } from './diagnosis-marker.mjs'
import { fixBotWillTry, FIX_BOT_MAX_ATTEMPTS } from './fix-bot-dispatch.mjs'

const fixture = (name) => readFileSync(new URL(`./__fixtures__/ci-logs/${name}`, import.meta.url), 'utf8')
const deploy3632 = fixture('pr3632-deploy-staging.txt')
const pr3211 = fixture('pr3211-deploy-staging.txt')
const main3211 = fixture('main-41611159317-deploy-staging.txt')
const node3522 = fixture('pr3522-node-checks.txt')

const bot = (body, login = 'nuxt-harness[bot]') => ({ user: { login, type: 'Bot' }, body })
const human = (body) => ({ user: { login: 'someone', type: 'User' }, body })
const SHA = '983ffca50333f998577fb3d43b6ece66b480e868'
const CHECK = 'Deploy Apps (Cloudflare Workers)'
const diagnosis = (line, { sha = SHA, round = 1 } = {}) =>
  `🩺 **Diagnosis**\n${diagnosisMarker({ sha, check: CHECK, round })}\n\n#### Stopped at\n\n\`\`\`\n${line}\n\`\`\`\n\n#### Cause\n\nx.ts:1 — y\n`
const verdictFile = (verdict, fails = []) => [
  '<!-- diagnosis-review:v1 -->', '### Verdict', verdict, '### Checks',
  ...['stopped-at', 'cause', 'since-when', 'proof', 'known-before'].map(n => `- ${n}: ${fails.includes(n) ? 'FAIL' : 'PASS'} — evidence for ${n}`),
  '### Points', ...(fails.length ? fails.map(f => `- redo ${f}`) : []),
].join('\n')

// ── How to test 1: a wrong diagnosis is rejected and goes back for a redo
test('wrong diagnosis is rejected (How to test 1): a TS2742 Stopped-at on the #3632 deploy log is noise', () => {
  const line = deploy3632.split('\n').find(l => l.includes('error TS2742')).replace(/^\S+Z /, '')
  const r = precheck({ diagnosisBody: diagnosis(line), rawLog: deploy3632 })
  assert.equal(r.ok, false)
  assert.ok(r.points.some(p => /noise line/.test(p) && p.includes('TS2742')), r.points.join('\n'))
  assert.equal(routeReview({ verdict: 'reject', round: 1 }), 'redo')
})
test('a Stopped-at line not in the log → rejected; the real RollupError line → ok', () => {
  const missing = precheck({ diagnosisBody: diagnosis('Error: something that never happened in this job'), rawLog: deploy3632 })
  assert.equal(missing.ok, false); assert.ok(missing.points.some(p => /not in the failed job's log/.test(p)))
  const real = deploy3632.split('\n').find(l => l.includes('RollupError:')).replace(/^\S+Z /, '')
  const ok = precheck({ diagnosisBody: diagnosis(`22: ${real}`), rawLog: deploy3632 })
  assert.equal(ok.ok, true, ok.points.join('\n'))
  assert.match(ok.line, /RollupError/)
})
test('precheck: the runner exit-code line and a missing Stopped-at section are rejected', () => {
  assert.equal(precheck({ diagnosisBody: diagnosis('##[error]Process completed with exit code 1.'), rawLog: '##[error]Process completed with exit code 1.' }).ok, false)
  assert.equal(precheck({ diagnosisBody: '🩺 **Diagnosis**\n#### Cause\nx', rawLog: deploy3632 }).ok, false)
  assert.equal(stoppedAtLine('nothing'), '')
})

test('parseReviewVerdict: approve with all PASS → approve; one FAIL → reject; empty/malformed → errors + reject', () => {
  assert.equal(parseReviewVerdict(verdictFile('approve')).verdict, 'approve')
  const oneFail = parseReviewVerdict(verdictFile('approve', ['cause']))
  assert.equal(oneFail.verdict, 'reject'); assert.ok(oneFail.points.some(p => p.startsWith('cause:')))
  for (const bad of ['', '   ', 'random text', '<!-- diagnosis-review:v1 -->\n### Verdict\nmaybe']) {
    const r = parseReviewVerdict(bad)
    assert.ok(r.errors.length > 0, JSON.stringify(bad)); assert.equal(r.verdict, 'reject')
  }
  const missingCheck = verdictFile('approve').split('\n').filter(l => !l.includes('known-before')).join('\n')
  assert.equal(parseReviewVerdict(missingCheck).verdict, 'reject')
})

// ── How to test 2: two rejections → an owner ask with both views
test('two rejections → owner (How to test 2)', () => {
  assert.equal(MAX_REVIEW_ROUNDS, 2)
  assert.equal(routeReview({ verdict: 'reject', round: 2 }), 'owner')
  assert.equal(routeReview({ verdict: 'approve', round: 2 }), 'fix')
  const ask = ownerAsk({ check: CHECK, sha: SHA, pr: 3192, rounds: [
    { diagnosisUrl: 'https://x/d1', reviewUrl: 'https://x/r1', points: ['p1'] },
    { diagnosisUrl: 'https://x/d2', reviewUrl: 'https://x/r2', points: ['p2'] },
  ] })
  const lines = ask.split('\n')
  assert.ok(lines[0].startsWith('## 🔀 Blocked —'))
  assert.equal(lines[1], '**Needs:** answer')
  const outsideCode = ask.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  assert.equal((outsideCode.match(/@pmcp\b/g) || []).length, 1)
  const details = ask.slice(ask.indexOf('<details>'), ask.indexOf('</details>'))
  for (const u of ['https://x/d1', 'https://x/r1', 'https://x/d2', 'https://x/r2']) {
    assert.ok(details.includes(u), u); assert.ok(!ask.slice(0, ask.indexOf('<details>')).includes(u), `${u} only inside details`)
  }
})

// #3668 review: nothing acts on a bare `ok` to an owner ask (the gate allows one diagnosis per head and
// check), so the ask must not offer it — only the `**Worker:**` reply, which resumes the worker.
test('the owner ask offers only an answer something acts on: no `ok` to redo the diagnosis', () => {
  const ask = ownerAsk({ check: CHECK, sha: SHA, pr: 3192, rounds: [{ points: ['p1'] }, { points: ['p2', 'p3'] }] })
  const visible = ask.slice(0, ask.indexOf('<details>'))
  assert.doesNotMatch(visible, /reply `ok`/)
  assert.doesNotMatch(visible, /redo the diagnosis/)
  assert.match(visible, /\*\*Recommendation:\*\* reply `\*\*Worker:\*\* <the cause>`/)
  assert.match(visible, /latest points, 2, are below/)
})

// ── How to test 3: no fix before approval
const review = (verdict, { sha = SHA, check = CHECK, round = 1 } = {}) => `🔎 **Diagnosis review**\n${reviewMarker({ sha, check, round, verdict })}`
test('no fix before approval (How to test 3): approvedDiagnosis', () => {
  const d = bot(diagnosis('##[error]boom'))
  assert.equal(approvedDiagnosis([d], { sha: SHA, check: CHECK }), null, 'no review')
  assert.equal(approvedDiagnosis([d, bot(review('reject'))], { sha: SHA, check: CHECK }), null, 'a reject')
  assert.equal(approvedDiagnosis([d, bot(review('approve', { sha: 'aaaaaaa' }))], { sha: SHA, check: CHECK }), null, 'other sha')
  assert.equal(approvedDiagnosis([d, bot(review('approve', { check: 'CI' }))], { sha: SHA, check: CHECK }), null, 'other check')
  assert.equal(approvedDiagnosis([d, human(review('approve'))], { sha: SHA, check: CHECK }), null, 'non-bot approve')
  assert.equal(approvedDiagnosis([human(diagnosis('x')), bot(review('approve'))], { sha: SHA, check: CHECK }), null, 'non-bot diagnosis')
  assert.equal(approvedDiagnosis([d, bot(review('approve'), 'github-actions[bot]')], { sha: SHA, check: CHECK }), d.body)
  const d2 = bot(diagnosis('##[error]boom2', { round: 2 }))
  assert.equal(approvedDiagnosis([d, bot(review('reject')), d2, bot(review('approve', { round: 2 }))], { sha: SHA, check: CHECK }), d2.body, 'round 2 approve hands over the round-2 diagnosis')
})
test('fixGo: the rule, not just the mechanism', () => {
  const g = (o) => fixGo({ mode: 'diagnose', ...o })
  assert.equal(g({ route1: '' }).go, false)
  assert.equal(g({ route1: 'redo', route2: '' }).go, false)
  assert.equal(g({ route1: 'redo', route2: 'owner' }).go, false)
  assert.deepEqual([g({ route1: 'fix' }).go, g({ route1: 'fix' }).from], [true, 'diagnosis'])
  assert.equal(g({ route1: 'redo', route2: 'fix' }).go, true)
  assert.equal(g({ route1: 'fix', headMoved: true }).go, false)
  assert.equal(g({ route1: 'fix', headMoved: 'true' }).go, false)
  assert.deepEqual([fixGo({ mode: 'fix' }).go, fixGo({ mode: 'fix' }).from], [true, 'log'])
  assert.equal(fixGo({ mode: 'fix', baseSkip: 'true' }).go, false)
  assert.equal(fixGo({ mode: 'fix', baseSkip: 'false', headMoved: '' }).go, true)
  assert.equal(fixGo({}).go, false)
})
test('worker hand-back carries the diagnosis: handoffLog', () => {
  const h = handoffLog({ approved: 'X', failingLog: 'Y' })
  assert.ok(h.indexOf('### Approved diagnosis') < h.indexOf('X')); assert.ok(h.indexOf('X') < h.indexOf('Y'))
  assert.equal(handoffLog({ approved: null, failingLog: 'Y' }), 'Y')
  assert.equal(handoffLog({ failingLog: 'Y' }), 'Y')
})

test('isMiss: an older approved diagnosis with the same Stopped-at line (other host/sha) → true', () => {
  const oldSha = '724ad7100000000000000000000000000000000a'
  const line = (host) => `[smoke] ✗ reads /api/collab/token: HTTP 400 — "url": "https://${host}/api/collab/token"`
  const thread = [bot(diagnosis(line('velo-pr3211.cloudflare-e53.workers.dev'), { sha: oldSha })), bot(review('approve', { sha: oldSha }))]
  assert.equal(isMiss({ comments: thread, check: CHECK, sha: SHA, failingLine: line('velo-pr3300.example.dev') }), true)
  assert.equal(missOf({ comments: thread, check: CHECK, sha: SHA, failingLine: line('x.dev') }), oldSha)
  assert.equal(isMiss({ comments: thread, check: CHECK, sha: SHA, failingLine: '##[error]something else entirely' }), false)
  const same = [bot(diagnosis(line('a.dev'))), bot(review('approve'))]
  assert.equal(isMiss({ comments: same, check: CHECK, sha: SHA, failingLine: line('a.dev') }), false, 'an approve on the same sha is not a miss')
})
test('normaliseLine strips URL origins, PR numbers, issue refs and shas', () => {
  assert.equal(normaliseLine('2026-11-03T11:29:53.9413443Z see https://velo-pr3211.x.dev/a for #3211 at 983ffca'), 'see /a for  at')
})

// ── #3270: the same failure on the base branch
test('#3270 signature, on the real logs: PR #3211 vs main → equal; vs #3522 → not', () => {
  assert.ok(pr3211.split('\n').includes("const lines = log.split('\\n').filter(l => l.includes('✗')).map(l => l.replace(/^\\[smoke\\] /, '')).slice(0, 20)"),
    'the untimestamped echoed script line stays in the fixture')
  const a = failureSignature(pr3211)
  const b = failureSignature(main3211)
  assert.ok(a.length === 2, JSON.stringify(a))
  assert.deepEqual(a, b)
  assert.ok(!a.join('\n').includes('workers.dev') && !b.join('\n').includes('pmcp.dev'), 'hosts stripped')
  assert.ok(!a.some(s => s.startsWith('const lines')), 'an untimestamped line never counts')
  assert.notDeepEqual(a, failureSignature(node3522))
})
const DEPLOY = 'deploy / Deploy velo (staging)'
test('pickBaseRun + baseVerdict (How to test of #3270)', () => {
  const red = { id: 1, status: 'completed', conclusion: 'failure', event: 'push', created_at: '2026-11-03T09:00:00Z' }
  const green = { id: 2, status: 'completed', conclusion: 'success', event: 'push', created_at: '2026-11-03T10:00:00Z' }
  const prRun = { id: 3, status: 'completed', conclusion: 'failure', event: 'pull_request', created_at: '2026-11-03T11:00:00Z' }
  const running = { id: 4, status: 'in_progress', conclusion: null, event: 'push', created_at: '2026-11-03T12:00:00Z' }
  assert.equal(pickBaseRun([red, prRun, running]).id, 1)
  assert.equal(pickBaseRun([red, green, prRun]).id, 2, 'a newer green base run beats an older red one')
  assert.equal(pickBaseRun([]), null)
  const prJobs = [{ name: DEPLOY, raw: pr3211 }]
  const baseJobs = [{ name: DEPLOY, conclusion: 'failure', raw: main3211 }]
  assert.deepEqual(baseVerdict({ prJobs, baseRun: red, baseJobs }), { skip: true, mainRed: [DEPLOY], own: [] })
  assert.deepEqual(baseVerdict({ prJobs, baseRun: pickBaseRun([red, green]), baseJobs }), { skip: false, mainRed: [], own: [DEPLOY] })
  assert.deepEqual(baseVerdict({ prJobs, baseRun: null, baseJobs: [] }), { skip: false, mainRed: [], own: [DEPLOY] })
  assert.deepEqual(baseVerdict({ prJobs, baseRun: red, baseJobs: [{ name: DEPLOY, conclusion: 'failure', raw: node3522 }] }).own, [DEPLOY], 'different signature')
  assert.deepEqual(baseVerdict({ prJobs: [...prJobs, { name: 'Fallow Audit', raw: node3522 }], baseRun: red, baseJobs }),
    { skip: false, mainRed: [DEPLOY], own: ['Fallow Audit'] }, 'mixed (#3211)')
})

// ── #3277: counter per head, one page per head
const commit = (message, committer = 'claude[bot]') => ({ commit: { message, committer: { name: committer } } })
test('effectiveAttempts: the label counts only while the head is a fix-bot commit', () => {
  assert.equal(effectiveAttempts({ labels: ['ci-fix-attempts:3'], headCommit: commit('feat: worker change') }), 0)
  assert.equal(effectiveAttempts({ labels: ['ci-fix-attempts:3'], headCommit: commit('fix: x\n\nCI-Fix: true') }), 3)
  assert.equal(effectiveAttempts({ labels: ['ci-fix-attempts:3'], headCommit: commit('fix: x\n\nCI-Fix: true', 'nuxt-harness[bot]') }), 0)
  assert.equal(effectiveAttempts({ labels: [], headCommit: commit('fix: x\n\nCI-Fix: true') }), 0)
})

// #3668 review: guard refused a bot fix → worker commit → same red must not reset the counter.
const FAIL = '2026-11-11T10:00:00.0000000Z ##[error]src/x.ts(3,1): error TS2304: Cannot find name \'compute\'.'
const OTHER = '2026-11-11T10:00:00.0000000Z ##[error]src/y.ts(9,1): error TS2322: Type \'string\' is not assignable to type \'number\'.'
const logWith = (line) => `2026-11-11T09:59:59.0000000Z Run pnpm typecheck\n${line}\n2026-11-11T10:00:01.0000000Z ##[error]Process completed with exit code 2.\n`
/** A fake Octokit over a PR's thread and one failed run's job logs — the REST API itself can't run here. */
const fakeGithub = ({ comments, log }) => ({
  paginate: async (fn, p) => fn(p),
  rest: {
    actions: {
      listJobsForWorkflowRun: async () => [{ id: 7, name: 'typecheck', conclusion: 'failure' }, { id: 8, name: 'CI Gate', conclusion: 'failure' }],
      downloadJobLogsForWorkflowRun: async ({ job_id }) => ({ data: job_id === 7 ? log : '{}' }),
    },
    issues: { listComments: async () => comments },
  },
})

test('handback marker round-trips with the normalised failing line; firstFailingLines skips logs with none', () => {
  const m = handbackMarker({ sha: 'abc1234', check: 'CI', line: FAIL })
  const p = parseHandbackMarker(`<!-- pipeline-note -->\n${m}\n🔧 refused`)
  assert.equal(p.check, 'CI'); assert.equal(p.sha, 'abc1234')
  assert.equal(p.line, normaliseLine(firstFailingLines([logWith(FAIL)])[0]))
  assert.equal(parseHandbackMarker('nope'), null)
  assert.deepEqual(firstFailingLines(['', '2026-11-11T10:00:00Z all good']), [])
})

test('carriesCount: a pipeline-bot hand-back on the same line carries; another line, check or a human copy does not', () => {
  const hb = (line, check = 'CI') => bot(`<!-- pipeline-note -->\n${handbackMarker({ sha: 'aaaaaaa', check, line })}`, 'github-actions[bot]')
  const lines = firstFailingLines([logWith(FAIL)])
  assert.equal(carriesCount({ comments: [hb(FAIL)], check: 'CI', sha: SHA, failingLines: lines }), true)
  assert.equal(carriesCount({ comments: [hb(OTHER)], check: 'CI', sha: SHA, failingLines: lines }), false, 'different line')
  assert.equal(carriesCount({ comments: [hb(FAIL, 'E2E')], check: 'CI', sha: SHA, failingLines: lines }), false, 'different check')
  assert.equal(carriesCount({ comments: [human(handbackMarker({ sha: 'aaaaaaa', check: 'CI', line: FAIL }))], check: 'CI', sha: SHA, failingLines: lines }), false, 'non-bot')
  assert.equal(carriesCount({ comments: [hb(FAIL), hb(OTHER)], check: 'CI', sha: SHA, failingLines: lines }), false, 'the newest hand-back decides')
  assert.equal(carriesCount({ comments: [hb(FAIL)], check: 'CI', sha: SHA, failingLines: [] }), false, 'no failing line')
})

test('bot fix refused → worker commit → same red: the counter keeps rising and stops at the cap', async () => {
  const worker = commit('feat: worker revision', 'nuxt-harness[bot]')
  const comments = []
  let labels = []
  const gate = async (log) => {
    const github = fakeGithub({ comments, log })
    const carry = await carriedTry({ github, owner: 'o', repo: 'r', pr: 1, sha: SHA, runId: 99, check: 'CI', labels, headCommit: worker })
    return fixBotWillTry({ head: 'work-1', base: 'main', state: 'open', labels, failures: [{ workflow: 'CI', conclusion: 'failure' }], headCommit: worker, carry })
  }
  const seen = []
  for (let round = 0; round < 10; round++) {
    const d = await gate(logWith(FAIL))
    seen.push(`${d.who}:${d.attempts}:${d.mode}`)
    if (d.who !== 'bot') break
    // job `fix`: the bump, then the guard refuses and hands back to the worker (its hidden marker).
    labels = [`ci-fix-attempts:${d.attempts + 1}`]
    comments.push(bot(`<!-- pipeline-note -->\n${handbackMarker({ sha: SHA, check: 'CI', line: FAIL })}\n🔧 refused`, 'github-actions[bot]'))
  }
  assert.deepEqual(seen, ['bot:0:fix', 'bot:1:diagnose', 'bot:2:diagnose', `gave-up:${FIX_BOT_MAX_ATTEMPTS}:fix`])
  // The worker really fixed it and a NEW line fails: new code, the count starts again.
  assert.equal((await gate(logWith(OTHER))).attempts, 0)
})

test('carriedTry reads nothing for a fix-bot head or a PR with no counted try, and a read error is false', async () => {
  const boom = { paginate: async () => { throw new Error('no network') }, rest: { actions: {}, issues: {} } }
  const base = { github: boom, owner: 'o', repo: 'r', pr: 1, sha: SHA, runId: 99, check: 'CI' }
  assert.equal(await carriedTry({ ...base, labels: ['ci-fix-attempts:2'], headCommit: commit('fix: x\n\nCI-Fix: true') }), false)
  assert.equal(await carriedTry({ ...base, labels: [], headCommit: commit('feat: w') }), false)
  assert.equal(await carriedTry({ ...base, labels: ['ci-fix-attempts:2'], headCommit: commit('feat: w') }), false)
})

test('CLI handback-marker reads the raw-log dir the fix job downloads', () => {
  const d = mkdtempSync(join(tmpdir(), 'handback-'))
  writeFileSync(join(d, '7.log'), logWith(FAIL))
  const out = execFileSync('node', [new URL('./diagnosis-review.mjs', import.meta.url).pathname, 'handback-marker', 'abc1234', 'CI', d], { encoding: 'utf8' }).trim()
  assert.deepEqual(parseHandbackMarker(out), { sha: 'abc1234', check: 'CI', line: normaliseLine(firstFailingLines([logWith(FAIL)])[0]) })
  const empty = mkdtempSync(join(tmpdir(), 'handback-'))
  assert.equal(execFileSync('node', [new URL('./diagnosis-review.mjs', import.meta.url).pathname, 'handback-marker', 'abc1234', 'CI', empty], { encoding: 'utf8' }).trim(), '')
})
test('#3277 one page: gaveUpPosted', () => {
  assert.equal(gaveUpPosted([], { sha: SHA }), false)
  assert.equal(gaveUpPosted([bot(`🔴 gave up\n${gaveUpMarker(SHA)}`, 'github-actions[bot]')], { sha: SHA }), true)
  assert.equal(gaveUpPosted([human(gaveUpMarker(SHA))], { sha: SHA }), false)
  assert.equal(gaveUpPosted([bot(gaveUpMarker('78cb09a'))], { sha: SHA }), false)
})
test('isPipelineBot: both pipeline bots, never a user or another bot', () => {
  assert.equal(isPipelineBot(bot('x')), true)
  assert.equal(isPipelineBot(bot('x', 'github-actions[bot]')), true)
  assert.equal(isPipelineBot(bot('x', 'dependabot[bot]')), false)
  assert.equal(isPipelineBot({ user: { login: 'nuxt-harness[bot]', type: 'User' } }), false)
})

test('review marker round-trips; renderReview carries it and the pipeline-note marker', () => {
  const m = reviewMarker({ sha: SHA, check: CHECK, round: 2, verdict: 'approve' })
  assert.deepEqual(parseReviewMarker(m), { sha: SHA, check: CHECK, round: 2, verdict: 'approve' })
  assert.equal(parseReviewMarker('nope'), null)
  const body = renderReview({ sha: SHA, check: CHECK, round: 1, verdict: 'reject', next: 'redo', points: ['p'] })
  assert.ok(body.startsWith('<!-- pipeline-note -->'))
  assert.deepEqual(parseReviewMarker(body), { sha: SHA, check: CHECK, round: 1, verdict: 'reject' })
  assert.match(body, /rejected \(round 1 of 2\)/)
  assert.ok(!body.includes('@'))
})
test('linkedRefs: issue refs (max 5) and run ids a diagnosis links', () => {
  const r = linkedRefs('see #3277 and https://github.com/o/r/issues/3270 and #3277, run https://github.com/o/r/actions/runs/41627100891/job/1 #1 #2 #3 #4 #5 #6')
  assert.deepEqual(r.issues.slice(0, 2), [3277, 3270])
  assert.ok(r.issues.length <= 5)
  assert.deepEqual(r.runs, [41627100891])
})

test('reviewer prompt shape: five checks, the same-issue rule, read-only', () => {
  const p = readFileSync(new URL('../../.claude/agents/diagnosis-reviewer.md', import.meta.url), 'utf8')
  for (const c of ['stopped-at', 'cause', 'since-when', 'proof', 'known-before']) assert.ok(p.includes(`- ${c}: PASS|FAIL`), c)
  assert.match(p, /failing line AND the cause/)
  assert.match(p, /Do NOT edit/); assert.match(p, /Do NOT post/)
  assert.ok(p.includes('<!-- diagnosis-review:v1 -->'))
})

// The CLI the workflow steps call — run as a real process on real files.
test('CLI route: a noise Stopped-at is rejected without a model verdict; an approve routes to fix', () => {
  const d = mkdtempSync(join(tmpdir(), 'diag-review-'))
  const log = join(d, '1.log'); writeFileSync(log, deploy3632)
  const bad = join(d, 'bad.md'); writeFileSync(bad, diagnosis(deploy3632.split('\n').find(l => l.includes('error TS2742')).replace(/^\S+Z /, '')))
  const good = join(d, 'good.md'); writeFileSync(good, diagnosis(deploy3632.split('\n').find(l => l.includes('RollupError:')).replace(/^\S+Z /, '')))
  const v = join(d, 'verdict.md'); writeFileSync(v, verdictFile('approve'))
  const run = (...a) => JSON.parse(execFileSync('node', [new URL('./diagnosis-review.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' }))
  const r1 = run('route', '1', bad, v, d)
  assert.equal(r1.verdict, 'reject'); assert.equal(r1.next, 'redo')
  const r2 = run('route', '2', good, v, d)
  assert.equal(r2.verdict, 'approve'); assert.equal(r2.next, 'fix')
  const r3 = run('route', '2', good, join(d, 'missing.md'), d)
  assert.equal(r3.next, 'owner', 'no verdict file on round 2 → owner')
  assert.equal(run('fix-go', JSON.stringify({ mode: 'diagnose', route1: 'redo', route2: 'fix' })).go, true)
})
