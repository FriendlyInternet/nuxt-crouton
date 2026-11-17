// The pipeline review every 10 closed epics (#3254): when one opens, what it says, what the model is
// given, and what gets posted. A wrong answer opens duplicate reviews, counts dropped epics, or posts a
// review whose data gaps nobody can see.
//   node --test scripts/pipeline-review.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  decideReview, renderReviewIssue, parseWindow, gatherArgs, qualityDigestFile, windowDays, cutDiff,
  finalizeReport, renderSkipped, reviewState, buildReviewPrompt
} from './pipeline-review.mjs'
import { count, gather, post } from './pipeline-review-run.mjs'

const NOW = '2026-11-17T06:45:00Z'
const harness = body => ({ body, user: { login: 'nuxt-harness[bot]', type: 'Bot' }, author_association: 'NONE' })
const actions = body => ({ body, user: { login: 'github-actions[bot]', type: 'Bot' }, author_association: 'CONTRIBUTOR' })
const outsider = body => ({ body, user: { login: 'x', type: 'User' }, author_association: 'NONE' })

// Completed epic n closed n hours after 1 Nov.
const epicIssue = (n, { reason = 'completed', hours = n } = {}) => {
  const closed = new Date(Date.parse('2026-11-01T00:00:00Z') + hours * 3600000).toISOString()
  return { number: n, title: `Epic ${n}`, state: 'closed', state_reason: reason, closed_at: closed, updated_at: closed, created_at: '2026-10-01T00:00:00Z', html_url: `https://github.com/o/r/issues/${n}`, labels: [{ name: 'epic' }] }
}
const epicOf = i => ({ number: i.number, title: i.title, closedAt: i.closed_at, url: i.html_url })

/** In-memory GitHub: issues list/create/comments. No search endpoint — any search call throws. */
function fakeGithub(issues = [], { clock = NOW } = {}) {
  const db = { issues: [...issues], comments: {}, next: 9000 }
  const listForRepo = async ({ labels, state = 'open', since, sort, direction }) => {
    let out = db.issues.filter(i => (labels ? (i.labels || []).some(l => l.name === labels) : true) && (state === 'all' || i.state === state))
    if (since) out = out.filter(i => Date.parse(i.updated_at) >= Date.parse(since))
    if (sort === 'created') out.sort((a, b) => (direction === 'asc' ? 1 : -1) * (Date.parse(a.created_at) - Date.parse(b.created_at)))
    return { data: out }
  }
  const github = {
    paginate: async (fn, params) => (await fn(params)).data,
    rest: {
      search: new Proxy({}, { get: () => () => { throw new Error('search must not be used (index lag)') } }),
      issues: {
        listForRepo,
        create: async ({ title, body, labels }) => {
          const i = { number: db.next++, title, body, state: 'open', created_at: clock, updated_at: clock, labels: labels.map(name => ({ name })), html_url: '' }
          db.issues.push(i)
          return { data: i }
        },
        listComments: async ({ issue_number }) => ({ data: db.comments[issue_number] || [] }),
        createComment: async ({ issue_number, body }) => {
          (db.comments[issue_number] ||= []).push(actions(body))
          return { data: {} }
        }
      }
    }
  }
  return { github, db }
}
const fakeCore = () => {
  const outputs = {}
  return { outputs, setOutput: (k, v) => { outputs[k] = v }, info: () => {}, warning: () => {} }
}
const ctx = gh => ({ github: gh.github, context: { repo: { owner: 'o', repo: 'r' } }, core: fakeCore() })
const reviewsIn = db => db.issues.filter(i => i.labels.some(l => l.name === 'pipeline-review'))

// ── T1 counter ────────────────────────────────────────────────────────────────

test('T1 decideReview: 10 completed epics since the last review opens; 9 does not', () => {
  const last = { number: 1, createdAt: '2026-11-01T00:30:00Z' }
  const ten = Array.from({ length: 10 }, (_, k) => epicOf(epicIssue(k + 1)))
  assert.equal(decideReview({ lastReview: last, epics: ten, now: NOW }).open, true)
  assert.equal(decideReview({ lastReview: last, epics: ten.slice(0, 9), now: NOW }).open, false)
  // an epic closed before the last review does not count
  const early = epicOf(epicIssue(99, { hours: 0 }))
  const d = decideReview({ lastReview: last, epics: [...ten.slice(0, 9), early], now: NOW })
  assert.equal(d.open, false)
  assert.equal(d.since, '2026-11-01T00:30:00.000Z')
})

test('T1 decideReview: no earlier review → the newest 10, since = the oldest of them', () => {
  const all = Array.from({ length: 28 }, (_, k) => epicOf(epicIssue(k + 1)))
  const d = decideReview({ lastReview: null, epics: all, now: NOW })
  assert.equal(d.open, true)
  assert.deepEqual(d.epics.map(e => e.number), [28, 27, 26, 25, 24, 23, 22, 21, 20, 19])
  assert.equal(d.since, all[18].closedAt)
})

test('T1 count: threshold 1 opens one issue listing exactly that one epic (How to test 1)', async () => {
  const gh = fakeGithub([epicIssue(5)])
  const c = ctx(gh)
  const r = await count(c, { threshold: 1, now: NOW, runUrl: 'https://run/1' })
  assert.equal(r.go, true)
  const reviews = reviewsIn(gh.db)
  assert.equal(reviews.length, 1)
  assert.deepEqual(parseWindow(reviews[0].body).epics, [5])
  assert.match(reviews[0].title, /^Pipeline review: 1 epics closed /)
  assert.deepEqual(reviews[0].labels.map(l => l.name), ['pipeline-review', 'meta:agents'])
  assert.equal(c.core.outputs.go, 'true')
  assert.equal(c.core.outputs.issue, String(reviews[0].number))
})

test('T1 count: a second run right after sees the issue just opened and opens nothing (How to test 2)', async () => {
  const gh = fakeGithub(Array.from({ length: 12 }, (_, k) => epicIssue(k + 1)))
  await count(ctx(gh), { now: NOW })
  const c2 = ctx(gh)
  const r2 = await count(c2, { now: NOW })
  assert.equal(r2.go, false)
  assert.equal(c2.core.outputs.go, 'false')
  assert.equal(reviewsIn(gh.db).length, 1)
})

test('T1 count: 28 completed epics, no earlier review → exactly one issue with the newest 10 (no backfill)', async () => {
  const gh = fakeGithub(Array.from({ length: 28 }, (_, k) => epicIssue(k + 1)))
  await count(ctx(gh), { now: NOW })
  const reviews = reviewsIn(gh.db)
  assert.equal(reviews.length, 1)
  assert.deepEqual(parseWindow(reviews[0].body).epics, [28, 27, 26, 25, 24, 23, 22, 21, 20, 19])
})

test('T1 count: not-planned epics and PR items from the list call are dropped', async () => {
  const pr = { ...epicIssue(50), pull_request: { url: 'x' } }
  const dropped = Array.from({ length: 5 }, (_, k) => epicIssue(30 + k, { reason: 'not_planned' }))
  const gh = fakeGithub([...Array.from({ length: 9 }, (_, k) => epicIssue(k + 1)), ...dropped, pr])
  const r = await count(ctx(gh), { now: NOW })
  assert.equal(r.go, false)
  assert.equal(r.decision.epics.length, 9)
  assert.ok(r.decision.epics.every(e => e.number < 10))
  assert.equal(reviewsIn(gh.db).length, 0)
})

test('T1 count: with an earlier review only epics closed after it count', async () => {
  const prev = { number: 7000, title: 'old', state: 'closed', created_at: '2026-11-01T05:30:00Z', updated_at: '2026-11-01T05:30:00Z', labels: [{ name: 'pipeline-review' }] }
  const gh = fakeGithub([prev, ...Array.from({ length: 14 }, (_, k) => epicIssue(k + 1))])
  const r = await count(ctx(gh), { now: NOW })
  assert.equal(r.go, false) // 6..14 = 9 after the review
  assert.equal(r.decision.epics.length, 9)
  gh.db.issues.push(epicIssue(15))
  assert.equal((await count(ctx(gh), { now: NOW })).go, true)
})

test('T1 count: dryRun creates nothing and sets go=false', async () => {
  const gh = fakeGithub(Array.from({ length: 10 }, (_, k) => epicIssue(k + 1)))
  const c = ctx(gh)
  const r = await count(c, { now: NOW, dryRun: true })
  assert.equal(r.go, false)
  assert.equal(c.core.outputs.go, 'false')
  assert.equal(reviewsIn(gh.db).length, 0)
})

test('renderReviewIssue: window marker, numbered epic links, data links, report-only line', () => {
  const epics = [epicOf(epicIssue(3)), epicOf(epicIssue(2))]
  const { title, body } = renderReviewIssue({ since: '2026-11-01T02:00:00Z', until: NOW, epics, runUrl: 'https://run/9', repo: 'o/r' })
  assert.equal(title, 'Pipeline review: 2 epics closed 2026-11-01…2026-11-17')
  assert.match(body, /^<!-- pipeline-review:window since=2026-11-01T02:00:00Z until=2026-11-17T06:45:00Z epics=3,2 -->/)
  assert.match(body, /^1\. \[#3 — Epic 3\]\(https:\/\/github.com\/o\/r\/issues\/3\)/m)
  assert.match(body, /https:\/\/github.com\/o\/r\/tree\/pipeline-data\/records/)
  assert.match(body, /metrics\/latest.json/)
  assert.match(body, /https:\/\/run\/9/)
  assert.match(body, /Report only — proposals become tickets only after your `ok`\./)
})

// ── T2 post ───────────────────────────────────────────────────────────────────

const tmp = () => mkdtempSync(join(tmpdir(), 'pipeline-review-'))
const REPORT = '## Top 3 causes\n1. lost hand-offs\n<!-- pipeline-review:report -->\n<!-- handoff:x -->'

test('T2 post: a non-empty model file posts one report with model markers removed', async () => {
  const d = tmp(); writeFileSync(join(d, 'review.md'), REPORT)
  const gh = fakeGithub([])
  await post(ctx(gh), { issue: 9000, modelFile: join(d, 'review.md'), gapsFile: join(d, 'none.json'), runUrl: 'https://run/1' })
  const cs = gh.db.comments[9000]
  assert.equal(cs.length, 1)
  assert.equal((cs[0].body.match(/<!--/g) || []).length, 1)
  assert.match(cs[0].body, /^<!-- pipeline-review:report -->\n> 🤖 \*\*pi.dev harness\*\*/)
  assert.doesNotMatch(cs[0].body, /handoff/)
  assert.equal(reviewState(cs), 'report')
})

test('T2 post: missing or empty model file posts the skipped note with the run link', async () => {
  for (const content of [null, '   \n']) {
    const d = tmp()
    if (content !== null) writeFileSync(join(d, 'review.md'), content)
    const gh = fakeGithub([])
    await post(ctx(gh), { issue: 9000, modelFile: join(d, 'review.md'), runUrl: 'https://run/2', writeResult: 'failure' })
    const cs = gh.db.comments[9000]
    assert.equal(cs.length, 1)
    assert.match(cs[0].body, /<!-- pipeline-review:skipped -->/)
    assert.match(cs[0].body, /https:\/\/run\/2/)
    assert.equal(reviewState(cs), 'skipped')
  }
})

test('T2 post: a second post after a report posts nothing', async () => {
  const d = tmp(); writeFileSync(join(d, 'review.md'), REPORT)
  const gh = fakeGithub([])
  const args = { issue: 9000, modelFile: join(d, 'review.md'), runUrl: 'https://run/1' }
  await post(ctx(gh), args)
  await post(ctx(gh), args)
  assert.equal(gh.db.comments[9000].length, 1)
})

test('reviewState: ignores markers from outsiders and inside code spans', () => {
  assert.equal(reviewState([outsider('<!-- pipeline-review:report -->')]), 'none')
  assert.equal(reviewState([harness('`<!-- pipeline-review:report -->`')]), 'none')
  assert.equal(reviewState([harness('<!-- pipeline-review:skipped -->'), harness('<!-- pipeline-review:report -->')]), 'report')
})

// ── T4 gather inputs ──────────────────────────────────────────────────────────

test('T4 gatherArgs: plain dates, --until one day after the window end', () => {
  assert.deepEqual(gatherArgs({ since: '2026-11-09T14:03:00Z', until: '2026-11-16T06:45:00Z' }), ['--since', '2026-11-09', '--until', '2026-11-17'])
})
test('T4 windowDays: start date through end date inclusive', () => {
  assert.deepEqual(windowDays({ since: '2026-11-09T14:03:00Z', until: '2026-11-16T06:45:00Z' }),
    ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'])
})
test('T4 qualityDigestFile: gather.mjs\'s dash-free name', () => {
  assert.equal(qualityDigestFile('2026-11-17'), 'writeups/reports/quality-digest-20261117.json')
})
test('T4 finalizeReport: gaps.records shows "no run records in this span" in the body', () => {
  const body = finalizeReport({ text: 'review', gaps: { records: 'no run records in this span', cutDiffs: [4], noDiff: [5] } })
  assert.match(body, /\*\*Data gaps:\*\* no run records in this span · diff cut for #4 · no diff for #5/)
  assert.match(renderSkipped({ runUrl: 'u', gaps: { records: 'no run records in this span' } }), /no run records in this span/)
})

// A temp repo with one two-parent merge commit; returns { dir, merge }.
function gitRepo() {
  const dir = tmp()
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'a')
  git('checkout', '-qb', 'feat')
  writeFileSync(join(dir, 'b.txt'), 'b\n'); git('add', '.'); git('commit', '-qm', 'b')
  git('checkout', '-q', 'main')
  writeFileSync(join(dir, 'c.txt'), 'c\n'); git('add', '.'); git('commit', '-qm', 'c')
  git('merge', '-q', '--no-ff', '-m', 'merge', 'feat')
  return { dir, merge: git('rev-parse', 'HEAD'), git }
}

const SINCE = '2026-11-09T14:03:00Z'
const UNTIL = '2026-11-16T06:45:00Z'

/** A fake `gh` (args → stdout) for gather + #3253's runEpicNumbers. `failNumbersFor` throws on that epic's sub-issues. */
function fakeGh({ merge, failNumbersFor = null } = {}) {
  const jl = xs => xs.map(x => JSON.stringify(x)).join('\n')
  return args => {
    const path = args[args.length - 1]
    if (path === 'repos/o/r/issues/9000') return JSON.stringify({ number: 9000, body: `<!-- pipeline-review:window since=${SINCE} until=${UNTIL} epics=1,2 -->` })
    let m = path.match(/^repos\/o\/r\/issues\/(\d+)$/)
    if (m) return JSON.stringify({ number: +m[1], title: `Epic ${m[1]}`, html_url: `u/${m[1]}`, closed_at: '2026-11-12T00:00:00Z', created_at: '2026-11-10T00:00:00Z' })
    if ((m = path.match(/^repos\/o\/r\/issues\/(\d+)\/comments/))) return jl([harness(`<!-- postmortem:done epic=#${m[1]} -->\nretro ${m[1]}`)])
    if ((m = path.match(/^repos\/o\/r\/issues\/(\d+)\/sub_issues/))) {
      if (Number(m[1]) === failNumbersFor) throw new Error('gh: HTTP 502')
      return ''
    }
    if (path.startsWith('repos/o/r/issues?labels=pipeline-review')) return '[]'
    if (path.startsWith('repos/o/r/pulls?')) {
      return JSON.stringify([
        { number: 50, title: 'feat', html_url: 'p/50', merged_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:00:00Z', merge_commit_sha: merge },
        { number: 51, title: 'gone', html_url: 'p/51', merged_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z', merge_commit_sha: 'f'.repeat(40) },
        { number: 52, title: 'old', html_url: 'p/52', merged_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-13T10:00:00Z', merge_commit_sha: merge }
      ])
    }
    if (/^repos\/o\/r\/pulls\/\d+\/files/.test(path)) return jl(['b.txt'])
    if (args[0] === 'pr' && args[1] === 'list') return '[]'
    throw new Error(`fake gh: unexpected ${args.join(' ')}`)
  }
}

/** A data dir: records/<days>, metrics/latest.json, epics/1.json (stored numbers for epic 1 only). */
function dataDir({ days = ['2026-11-12', '2026-11-20'], records = true } = {}) {
  const d = tmp()
  if (records) {
    mkdirSync(join(d, 'records'))
    for (const day of days) {
      mkdirSync(join(d, 'records', day))
      writeFileSync(join(d, 'records', day, '1-1.json'), JSON.stringify({ day, issue: 1, stage: 'build' }))
    }
  }
  mkdirSync(join(d, 'metrics')); writeFileSync(join(d, 'metrics', 'latest.json'), '{"m":1}')
  mkdirSync(join(d, 'epics')); writeFileSync(join(d, 'epics', '1.json'), '{"epic":1,"stored":true}')
  return d
}

const stubGather = (content = '{"q":1}') => ({ args, cwd }) => {
  if (content === null) return
  const f = join(cwd, qualityDigestFile(args[3]))
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content)
}

const runGatherWith = async ({ repo, data, gh, runGather = stubGather() }) => {
  const out = join(tmp(), 'bundle')
  const r = await gather({ issue: 9000, since: SINCE, until: UNTIL, outDir: out, dataDir: data, repoDir: repo.dir, env: { GITHUB_REPOSITORY: 'o/r' }, gh, git: (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8' }), runGather })
  return { out, r, read: f => readFileSync(join(out, f), 'utf8'), json: f => JSON.parse(readFileSync(join(out, f), 'utf8')) }
}

test('T4 gather: quality.json is the dash-free digest file; records only from window days; numbers stored or computed', async () => {
  const repo = gitRepo()
  const { json, out } = await runGatherWith({ repo, data: dataDir(), gh: fakeGh({ merge: repo.merge }) })
  assert.deepEqual(json('quality.json'), { q: 1 })
  assert.deepEqual(json('records.json'), [{ day: '2026-11-12', issue: 1, stage: 'build' }])
  assert.equal(existsSync(join(out, 'records-missing.txt')), false)
  assert.deepEqual(json('epic-numbers/1.json'), { epic: 1, stored: true })
  assert.equal(json('epic-numbers/2.json').epic, 2) // computed by runEpicNumbers with the fake gh
  assert.equal(existsSync(join(out, 'epic-numbers', 'missing.txt')), false)
  assert.deepEqual(json('metrics.json'), { m: 1 })
  assert.deepEqual(json('epics.json').map(e => [e.number, /retro/.test(e.postmortem)]), [[1, true], [2, true]])
  assert.equal(json('gaps.json').records, null)
})

test('T4 gather: a failing numbers computation lands in missing.txt and gather still completes', async () => {
  const repo = gitRepo()
  const { read, out } = await runGatherWith({ repo, data: dataDir(), gh: fakeGh({ merge: repo.merge, failNumbersFor: 2 }) })
  assert.match(read('epic-numbers/missing.txt'), /^#2 — .*502/m)
  assert.equal(existsSync(join(out, 'epic-numbers', '2.json')), false)
  assert.ok(existsSync(join(out, 'gaps.json')))
})

test('T4 gather: no quality digest file after gather.mjs → fails naming the expected path', async () => {
  const repo = gitRepo()
  await assert.rejects(runGatherWith({ repo, data: dataDir(), gh: fakeGh({ merge: repo.merge }), runGather: stubGather(null) }),
    /quality-digest-20261117\.json/)
})

test('T4 gather: records/ holds only out-of-window days → no records.json, records-missing.txt, gaps.records', async () => {
  const repo = gitRepo()
  const { out, read, json } = await runGatherWith({ repo, data: dataDir({ days: ['2026-11-20'] }), gh: fakeGh({ merge: repo.merge }) })
  assert.equal(existsSync(join(out, 'records.json')), false)
  assert.match(read('records-missing.txt'), /no run records in this span/)
  assert.equal(json('gaps.json').records, 'no run records in this span')
})

test('T4 gather: no records/ folder at all → fails naming the path', async () => {
  const repo = gitRepo()
  const data = dataDir({ records: false })
  await assert.rejects(runGatherWith({ repo, data, gh: fakeGh({ merge: repo.merge }) }), new RegExp(`${join(data, 'records').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`))
})

// ── T6 diffs ──────────────────────────────────────────────────────────────────

test('T6 cutDiff: a 10 KB diff stays whole; an 80 KB diff is cut at a line end with a note', () => {
  const line = 'x'.repeat(99) + '\n'
  const small = line.repeat(100)
  assert.deepEqual(cutDiff(small), { text: small, cut: false, bytes: 10000, keptBytes: 10000 })
  const big = line.repeat(800)
  const c = cutDiff(big)
  assert.equal(c.cut, true)
  assert.equal(c.bytes, 80000)
  assert.ok(c.keptBytes <= 40000)
  assert.equal(c.keptBytes % 100, 0) // ends on a full line
  assert.ok(c.text.endsWith(`# [cut: kept ${c.keptBytes} of 80000 bytes]\n`))
})

test('T6 gather: diffs/<N>.diff is git diff <merge>^1 <merge>; a missing merge commit → diffFile null + gaps.noDiff', async () => {
  const repo = gitRepo()
  const { read, json } = await runGatherWith({ repo, data: dataDir(), gh: fakeGh({ merge: repo.merge }) })
  const expected = execFileSync('git', ['diff', `${repo.merge}^1`, repo.merge], { cwd: repo.dir, encoding: 'utf8' })
  assert.equal(read('diffs/50.diff'), expected)
  const prs = json('merged-prs.json')
  assert.deepEqual(prs.map(p => p.number), [50, 51]) // #52 merged before the window
  assert.deepEqual({ ...prs[0], files: prs[0].files }, { number: 50, title: 'feat', url: 'p/50', mergeCommit: repo.merge, files: ['b.txt'], diffFile: 'diffs/50.diff', diffBytes: Buffer.byteLength(expected), keptBytes: Buffer.byteLength(expected), cut: false })
  assert.equal(prs[1].diffFile, null)
  assert.ok(prs[1].diffError)
  assert.deepEqual(json('gaps.json').noDiff, [51])
})

test('T6 buildReviewPrompt: names diffs/, grades only the diff, says when cut, no recount, records-missing', () => {
  const p = buildReviewPrompt({ bundleDir: '/b', outFile: '/o/review.md' })
  assert.match(p, /\/b\/merged-prs\.json` \+ `\/b\/diffs\/<N>\.diff/)
  assert.match(p, /Grade ONLY what is in `diffs\/<N>\.diff`/)
  assert.match(p, /not graded \(no diff\)/)
  assert.match(p, /graded on the first <keptBytes> of <diffBytes> bytes/)
  assert.match(p, /do NOT recount them from records\.json/)
  assert.match(p, /records-missing\.txt/)
  assert.match(p, /\/o\/review\.md/)
  assert.match(p, /Top 3 causes/)
  assert.match(p, /cause \| count \| trend vs previous \| ticket/)
})
