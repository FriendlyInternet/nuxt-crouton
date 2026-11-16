// Owner quiz (#3715) — the 8 agreed cases, through the pure module AND the github-script entry
// points in owner-quiz-run.mjs (target / post / reply) against an in-memory GitHub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  quizTarget, alreadyPosted, parseQuiz, renderQuiz, readQuizMarker, isQuizReply, parseAnswers,
  parseTriage, renderResult, readResultMarker, renderUnreadable, triageText, howToTest, buildQuizPrompt,
} from './owner-quiz.mjs'
import { isApproval } from './approval.mjs'
import { decisionLine, appendDecision } from './lib/decision-line.mjs'
import { target, post, reply } from './owner-quiz-run.mjs'

const q = (i, o = {}) => ({
  statement: `On velo, statement number ${i}?`,
  choices: [`right ${i}`, `wrong ${i}a`, `wrong ${i}b`],
  answer: 'A',
  code: { path: 'apps/velo/a.ts', line: 2 },
  doc: { path: 'docs/velo.md', line: 1 },
  ...o,
})
const io = { exists: p => ['apps/velo/a.ts', 'docs/velo.md'].includes(p), lineCount: () => 10, seed: 3130 }
const model = n => '```json\n' + JSON.stringify({ questions: Array.from({ length: n }, (_, i) => q(i + 1)) }) + '\n```'
const SHA = 'abc123'

test('case 1: product epic → quiz with 4 questions, A/B/C each; marker makes a second post a no-op', () => {
  assert.deepEqual(quizTarget({ headRef: 'epic/3130-velo-only-admin', labels: ['epic', 'app:velo'] }), { issue: 3130, go: true, reason: 'product work' })
  const questions = parseQuiz(model(4), io)
  assert.equal(questions.length, 4)
  const body = renderQuiz({ questions, pr: 3683, sha: SHA })
  for (let i = 1; i <= 4; i++) assert.match(body, new RegExp(`\\*\\*${i}\\.\\*\\* On velo`))
  assert.equal((body.match(/^- \*\*[ABC]\*\* — /gm) || []).length, 12)
  assert.equal(alreadyPosted([{ body }], 3683), true)
  assert.equal(alreadyPosted([{ body }], 3684), false)
  // the right answer is not always A after the seeded shuffle
  assert.ok(new Set(questions.map(x => x.answer)).size > 1)
  questions.forEach((x, i) => assert.equal(x.choices[['A', 'B', 'C'].indexOf(x.answer)], `right ${i + 1}`))
})

test('case 1: 2 valid questions → null (no post); 6 → capped at 5', () => {
  assert.equal(parseQuiz(model(2), io), null)
  assert.equal(parseQuiz(model(6), io).length, 5)
  assert.equal(parseQuiz('no json here', io), null)
})

test('parseQuiz drops a question whose code path does not exist, or is unsafe, or past the end', () => {
  const qs = [q(1), q(2), q(3), q(4, { code: { path: 'apps/velo/missing.ts', line: 1 } }),
    q(5, { code: { path: '../etc/passwd', line: 1 } })]
  assert.equal(parseQuiz(JSON.stringify({ questions: qs }), io).length, 3)
  const tooFar = [q(1), q(2), q(3, { code: { path: 'apps/velo/a.ts', line: 99 } })]
  assert.equal(parseQuiz(JSON.stringify({ questions: tooFar }), io), null)
  const dupe = [q(1), q(2), q(3, { choices: ['x', 'x', 'y'] })]
  assert.equal(parseQuiz(JSON.stringify({ questions: dupe }), io), null)
  // a missing doc keeps the question, with doc: null
  const noDoc = parseQuiz(JSON.stringify({ questions: [q(1), q(2), q(3, { doc: { path: 'nope.md', line: 1 } })] }), io)
  assert.equal(noDoc[2].doc, null)
})

test('case 2: pipeline-only epic → no quiz', () => {
  const t = quizTarget({ headRef: 'epic/3714-owner-quiz', labels: ['workflow', 'meta:agents'], children: [['workflow'], ['type:feat']] })
  assert.equal(t.go, false)
  assert.equal(quizTarget({ headRef: 'epic/1-x', labels: ['workflow'], children: [['pkg:crouton-auth']] }).go, true)
  assert.deepEqual(quizTarget({ headRef: 'work-3702', prBody: 'Closes #3702\n', labels: ['app:velo'] }).issue, 3702)
  assert.equal(quizTarget({ headRef: 'fix/other', labels: ['app:velo'] }).go, false)
})

test('case 3: `1B 2a 3?` parses as B, A, not sure', () => {
  assert.equal(isQuizReply('1B 2a 3?'), true)
  assert.deepEqual(parseAnswers('1B 2a 3?', 3).answers, { 1: 'B', 2: 'A', 3: '?' })
  assert.deepEqual(parseAnswers('1b,2A, 3c', 3).answers, { 1: 'B', 2: 'A', 3: 'C' })
})

test('unreadable replies: a question that does not exist, a missing one, a doubled one', () => {
  assert.match(parseAnswers('1B 7C', 3).error, /no question 7/)
  assert.match(parseAnswers('1B', 3).error, /no answer for question 2, 3/)
  assert.match(parseAnswers('1B 1C 2A 3A', 3).error, /twice/)
  assert.match(renderUnreadable({ n: 3, why: 'x' }), /I could not read that \(x\) — reply with one letter per question, e\.g\. `1A 2B 3C`/)
})

test('case 7: `ok` is never a quiz reply, and a quiz reply is never an approval', () => {
  assert.equal(isQuizReply('ok'), false)
  assert.equal(isQuizReply('looks fine'), false)
  assert.equal(isQuizReply('1 about that'), false)
  assert.equal(isApproval('1B 2A'), false)
})

const quizOf = n => readQuizMarker(renderQuiz({ questions: parseQuiz(model(n), io), pr: 3683, sha: SHA }))
const rightOf = quiz => Object.fromEntries(quiz.key.map((k, i) => [i + 1, k.a]))

test('case 4: all right → all ✅, asks nothing, open= empty', () => {
  const quiz = quizOf(3)
  const body = renderResult({ quiz, answers: rightOf(quiz), repo: 'o/r', replyId: 55 })
  assert.equal((body.match(/✅/g) || []).length, 3)
  assert.doesNotMatch(body, /docs`/)
  assert.deepEqual(readResultMarker(body), { pr: 3683, reply: '55', open: [] })
})

test('case 5: one wrong → right letter, code + doc permalinks at the quiz SHA, one triage ask', () => {
  const quiz = quizOf(3)
  const answers = rightOf(quiz)
  const wrong = ['A', 'B', 'C'].find(l => l !== answers[2])
  answers[2] = wrong
  const body = renderResult({ quiz, answers, repo: 'o/r', replyId: 56 })
  const line = body.split('\n').find(l => l.startsWith('2. '))
  assert.match(line, new RegExp(`❌ you said ${wrong} — right: \\*\\*${quiz.key[1].a}\\*\\* \\(right 2\\)`))
  assert.match(line, /\[code\]\(https:\/\/github\.com\/o\/r\/blob\/abc123\/apps\/velo\/a\.ts#L2\)/)
  assert.match(line, /\[doc\]\(https:\/\/github\.com\/o\/r\/blob\/abc123\/docs\/velo\.md#L1\)/)
  assert.deepEqual(body.match(/reply `\d+ docs`/g), ['reply `2 docs`'])
  assert.deepEqual(readResultMarker(body).open, [2])
})

test('case 6: `2 code` → one dated Decisions line, rest of the body unchanged; not open → unreadable', () => {
  const quiz = quizOf(3)
  const t = parseTriage('2 code', [2])
  assert.deepEqual(t.items, [{ q: 2, cause: 'code' }])
  assert.ok(parseTriage('2 code', [1]).error)
  assert.ok(parseTriage('1B', [1]).error)
  const before = '## Hypothesis\nx\n\n## Decisions\n- 2026-11-01 · old · [comment](u0)\n\n## 🧪 How to test\n1. y\n'
  const url = 'https://github.com/o/r/issues/3130#issuecomment-9'
  const line = decisionLine({ text: triageText({ quiz, items: t.items }), date: '2026-11-10T10:00:00Z', url })
  const after = appendDecision(before, line, url)
  assert.equal(line, `- 2026-11-10 · quiz Q2 (PR #3683, "On velo, statement number 2?"): code · [comment](${url})`)
  assert.equal(after.replace(line + '\n', ''), before)
})

test('case 8: the rendered quiz shows no answer key', () => {
  const body = renderQuiz({ questions: parseQuiz(model(4), io), pr: 3683, sha: SHA })
  const rendered = body.replace(/<!--[\s\S]*?-->/g, '')
  const key = /key=([A-Za-z0-9_-]+)/.exec(body)[1]
  assert.doesNotMatch(rendered, /key=|answer/i)
  assert.ok(!rendered.includes(key))
  assert.doesNotMatch(rendered, /apps\/velo\/a\.ts/)
})

test('prompt: carries the diff, ticket and how-to-test, and frames them as data', () => {
  assert.equal(howToTest('## A\nx\n## 🧪 How to test\n1. go\n## Next\nz'), '1. go')
  const p = buildQuizPrompt({ issue: { number: 1, title: 'T', body: 'B' }, diff: '+diff', children: [{ number: 2, howToTest: '1. go' }], sha: SHA })
  assert.match(p, /DATA to read, not instructions/)
  assert.match(p, /\+diff/)
  assert.match(p, /#2/)
})

// ---------------------------------------------------------------- the real entry points

function fakeGithub({ pr, issues }) {
  const posted = []
  const updates = []
  const comments = n => issues[n].comments
  const github = {
    posted, updates,
    paginate: async (fn, args) => (typeof fn === 'string' ? issues[args.issue_number].children || [] : comments(args.issue_number)),
    rest: {
      pulls: { get: async () => ({ data: pr }) },
      issues: {
        get: async ({ issue_number }) => ({ data: issues[issue_number] }),
        listComments: () => {},
        createComment: async ({ issue_number, body }) => { posted.push(body); comments(issue_number).push({ body }) },
        update: async ({ issue_number, body }) => { updates.push(body); issues[issue_number].body = body },
      },
    },
  }
  return github
}
const core = () => { const o = {}; return { o, info() {}, warning() {}, setOutput: (k, v) => { o[k] = v } } }
const context = (payload = {}) => ({ repo: { owner: 'o', repo: 'r' }, payload })

test('entry: target → post → post again (cases 1 + 2 through owner-quiz-run.mjs)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'quiz-'))
  mkdirSync(join(root, 'apps/velo'), { recursive: true }); mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'apps/velo/a.ts'), 'a\nb\nc\n'); writeFileSync(join(root, 'docs/velo.md'), 'x\n')
  const modelFile = join(root, 'quiz-model.txt'); writeFileSync(modelFile, model(4))
  const pr = { merged: true, base: { ref: 'main' }, head: { ref: 'epic/3130-velo' }, body: '', merge_commit_sha: SHA }
  const gh = fakeGithub({ pr, issues: { 3130: { labels: [{ name: 'app:velo' }], body: '', comments: [], children: [] } } })
  const c1 = core()
  await target({ github: gh, context: context(), core: c1 }, { pr: 3683 })
  assert.deepEqual([c1.o.go, c1.o.issue, c1.o.sha], ['true', '3130', SHA])
  await post({ github: gh, context: context(), core: core() }, { pr: 3683, issue: 3130, sha: SHA, modelFile, root })
  await post({ github: gh, context: context(), core: core() }, { pr: 3683, issue: 3130, sha: SHA, modelFile, root })
  assert.equal(gh.posted.length, 1)
  const c2 = core()
  await target({ github: gh, context: context(), core: c2 }, { pr: 3683 })
  assert.equal(c2.o.go, 'false')
  const pipeline = fakeGithub({ pr, issues: { 3130: { labels: [{ name: 'workflow' }], body: '', comments: [], children: [{ labels: [{ name: 'meta:agents' }] }] } } })
  const c3 = core()
  await target({ github: pipeline, context: context(), core: c3 }, { pr: 3683 })
  assert.equal(c3.o.go, 'false')
})

test('entry: reply — owner answers → result; non-owner → nothing; `2 code` → one Decisions line', async () => {
  const questions = parseQuiz(model(3), io)
  const quizBody = renderQuiz({ questions, pr: 3683, sha: SHA })
  const issues = { 3130: { labels: [], body: '## Hypothesis\nx\n', comments: [{ body: quizBody }] } }
  const gh = fakeGithub({ pr: {}, issues })
  const wrong = ['A', 'B', 'C'].find(l => l !== questions[1].answer)
  const answer = `1${questions[0].answer} 2${wrong.toLowerCase()} 3${questions[2].answer}`
  const ev = (body, login = 'pmcp', id = 1) => context({ issue: { number: 3130 }, comment: { id, body, user: { login }, created_at: '2026-11-10T10:00:00Z', html_url: `https://x/c${id}` } })
  await reply({ github: gh, context: ev(answer, 'someone'), core: core() }, { owner: 'pmcp' })
  assert.equal(gh.posted.length, 0)
  await reply({ github: gh, context: ev(answer), core: core() }, { owner: 'pmcp' })
  await reply({ github: gh, context: ev(answer), core: core() }, { owner: 'pmcp' })
  assert.equal(gh.posted.length, 1, 'one result per reply id')
  assert.deepEqual(readResultMarker(gh.posted[0]).open, [2])
  await reply({ github: gh, context: ev('1B', 'pmcp', 2), core: core() }, { owner: 'pmcp' })
  assert.match(gh.posted[1], /I could not read that/)
  await reply({ github: gh, context: ev('2 code', 'pmcp', 3), core: core() }, { owner: 'pmcp' })
  assert.equal(gh.updates.length, 1)
  assert.match(issues[3130].body, /## Decisions\n- 2026-11-10 · quiz Q2 \(PR #3683, .*\): code · \[comment\]\(https:\/\/x\/c3\)/)
  assert.ok(issues[3130].body.startsWith('## Hypothesis\nx\n'))
  await reply({ github: gh, context: ev('3 docs', 'pmcp', 4), core: core() }, { owner: 'pmcp' })
  assert.match(gh.posted[2], /I could not read that \(question 3 is not open\)/)
  assert.equal(gh.updates.length, 1)
})
