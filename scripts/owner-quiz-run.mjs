// owner-quiz-run.mjs — GitHub I/O for the owner quiz (#3715). The decisions are pure, in
// owner-quiz.mjs; these functions take the github-script `{ github, context, core }` (same shape as
// epic-ready-pr.mjs) and are called from owner-quiz.yml (target / prompt / post) and on-comment.yml
// (`quiz-reply`). Every failure is logged and swallowed: the quiz never blocks anything and never
// touches a label.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  quizIssue, quizTarget, alreadyPosted, howToTest, buildQuizPrompt, parseQuiz, renderQuiz,
  readQuizMarker, replyKind, parseAnswers, parseTriage, renderResult, readResultMarker, resultPosted,
  renderUnreadable, triageText,
} from './owner-quiz.mjs'
import { decisionLine, appendDecision } from './lib/decision-line.mjs'

const labelNames = ls => (ls || []).map(l => (typeof l === 'string' ? l : l.name))

async function subIssues({ github, context }, issue_number) {
  try {
    return await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...context.repo, issue_number, per_page: 100 })
  } catch { return [] }
}

/** Which issue to quiz, and whether to. Sets outputs `issue`, `go`, `sha`. */
export async function target({ github, context, core }, { pr }) {
  const p = (await github.rest.pulls.get({ ...context.repo, pull_number: Number(pr) })).data
  const out = (go, issue, why) => {
    core.info(`owner-quiz target: PR #${pr} → issue ${issue ?? '-'} go=${go} (${why})`)
    core.setOutput('go', String(go)); core.setOutput('issue', String(issue ?? '')); core.setOutput('sha', p.merge_commit_sha || '')
    return { go, issue }
  }
  if (!p.merged || p.base.ref !== 'main') return out(false, null, 'not merged into main')
  const n = quizIssue({ headRef: p.head.ref, prBody: p.body })
  if (!n) return out(false, null, `head ${p.head.ref} has no quiz issue`)
  const issue = (await github.rest.issues.get({ ...context.repo, issue_number: n })).data
  const kids = await subIssues({ github, context }, n)
  const t = quizTarget({ headRef: p.head.ref, prBody: p.body, labels: labelNames(issue.labels), children: kids.map(k => labelNames(k.labels)) })
  if (!t.go) return out(false, n, t.reason)
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: n, per_page: 100 })
  if (alreadyPosted(comments, Number(pr))) return out(false, n, 'quiz already posted for this PR')
  return out(true, n, t.reason)
}

/** Write the model prompt to `file` (read-only token; the model runs in this job afterwards). */
export async function writePrompt({ github, context }, { pr, issue: n, sha, file }) {
  const issue = (await github.rest.issues.get({ ...context.repo, issue_number: Number(n) })).data
  const diff = String((await github.rest.pulls.get({ ...context.repo, pull_number: Number(pr), mediaType: { format: 'diff' } })).data)
  const kids = await subIssues({ github, context }, Number(n))
  const children = kids.map(k => ({ number: k.number, title: k.title, howToTest: howToTest(k.body) }))
  if (!children.length) children.push({ number: issue.number, title: issue.title, howToTest: howToTest(issue.body) })
  writeFileSync(file, buildQuizPrompt({ issue, diff: diff.slice(0, 60000), children, sha }))
}

/** Validate the model's quiz against the checkout (at the merge SHA) and post it. */
export async function post({ github, context, core }, { pr, issue, sha, modelFile, root }) {
  let text = ''
  try { text = readFileSync(modelFile, 'utf8') } catch { /* no model output */ }
  const abs = p => join(root, p)
  const exists = p => existsSync(abs(p)) && statSync(abs(p)).isFile()
  const lineCount = p => readFileSync(abs(p), 'utf8').split('\n').length
  const questions = parseQuiz(text, { exists, lineCount, seed: Number(pr) })
  if (!questions) { core.warning(`owner-quiz: fewer than 3 valid questions for PR #${pr} — posting nothing.`); return }
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: Number(issue), per_page: 100 })
  if (alreadyPosted(comments, Number(pr))) { core.info('quiz already posted'); return }
  await github.rest.issues.createComment({ ...context.repo, issue_number: Number(issue), body: renderQuiz({ questions, pr: Number(pr), sha }) })
  core.info(`owner-quiz: posted ${questions.length} questions on #${issue}`)
}

/** The owner's reply on the epic: answers → result comment; triage → a Decisions line. */
export async function reply({ github, context, core }, { owner }) {
  const c = context.payload.comment
  const n = context.payload.issue.number
  if (c.user.login !== owner) { core.info(`quiz-shaped reply from ${c.user.login}, not ${owner} — ignored.`); return }
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: n, per_page: 100 })
  const quizzes = comments.map(x => readQuizMarker(x.body)).filter(Boolean)
  const quiz = quizzes[quizzes.length - 1]
  if (!quiz) { core.info(`no quiz on #${n} — nothing to read.`); return }
  const say = body => github.rest.issues.createComment({ ...context.repo, issue_number: n, body })
  const kind = replyKind(c.body)
  if (kind === 'triage') {
    const results = comments.map(x => readResultMarker(x.body)).filter(r => r && r.pr === quiz.pr)
    const t = parseTriage(c.body, results[results.length - 1]?.open || [])
    if (t.error) return say(renderUnreadable({ why: t.error, triage: true }))
    const { data: fresh } = await github.rest.issues.get({ ...context.repo, issue_number: n })
    const line = decisionLine({ text: triageText({ quiz, items: t.items }), date: c.created_at, url: c.html_url })
    const next = appendDecision(fresh.body, line, c.html_url)
    if (next === fresh.body) return core.info('already recorded')
    await github.rest.issues.update({ ...context.repo, issue_number: n, body: next })
    return core.info(`owner-quiz: recorded ${t.items.length} triage item(s) on #${n}`)
  }
  if (resultPosted(comments, c.id)) return core.info('result already posted for this reply')
  const a = parseAnswers(c.body, quiz.key.length)
  if (a.error) return say(renderUnreadable({ n: quiz.key.length, why: a.error }))
  await say(renderResult({ quiz, answers: a.answers, repo: `${context.repo.owner}/${context.repo.repo}`, replyId: c.id }))
  core.info(`owner-quiz: posted the result on #${n}`)
}
