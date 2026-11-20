// The daily suggestions CLI (#4308) through its real entry points: `gather` against a real git
// repo with a real `pipeline-data` branch (empty and filled), and `post` deciding against a
// recorded `gh` (no network; the gh calls it would make are the assertions).
//   node --test scripts/suggestions-daily.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gather, post, LABEL } from './suggestions-daily.mjs'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** A repo whose `origin` holds a `pipeline-data` branch with the given files. */
function repoWith(files) {
  const origin = mkdtempSync(join(tmpdir(), 'sd-origin-'))
  git(origin, 'init', '-q', '-b', 'pipeline-data')
  git(origin, 'config', 'user.email', 't@t'); git(origin, 'config', 'user.name', 't')
  writeFileSync(join(origin, 'README.md'), 'data\n')
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(origin, p, '..'), { recursive: true })
    writeFileSync(join(origin, p), body)
  }
  git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'data')
  const work = mkdtempSync(join(tmpdir(), 'sd-work-'))
  git(work, 'init', '-q')
  git(work, 'remote', 'add', 'origin', origin)
  return work
}

const good = (over = {}) => JSON.stringify({ ts: '2026-11-19T10:00:00.000Z', source: 'worker run 1', area: 'pipeline', text: 'One idea', evidence: 'https://github.com/x/y/issues/1', ...over })

// covers: T4
test('gather on a log with no suggestions/ folder → lines.json [], no prompt, "log is empty", lines=0', () => {
  const cwd = repoWith({})
  const dir = mkdtempSync(join(tmpdir(), 'sd-out-'))
  const out = join(dir, 'gh-output')
  const logs = []
  const lines = gather(dir, { cwd, env: { GITHUB_OUTPUT: out }, log: (m) => logs.push(m) })
  assert.deepEqual(lines, [])
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'lines.json'), 'utf8')), [])
  assert.equal(existsSync(join(dir, 'prompt.txt')), false)
  assert.deepEqual(logs, ['log is empty'])
  assert.equal(readFileSync(out, 'utf8'), 'lines=0\n')
})

// covers: T4
test('gather on a filled log → valid lines with their path as id, invalid ones skipped and named, prompt names groups.json', () => {
  const cwd = repoWith({
    'suggestions/2026-11-19/a.json': good(),
    'suggestions/2026-11-19/b.json': good({ area: 'nope' }),
    'suggestions/2026-11-20/c.json': 'not json',
  })
  const dir = mkdtempSync(join(tmpdir(), 'sd-out-'))
  const out = join(dir, 'gh-output')
  const logs = []
  const lines = gather(dir, { cwd, env: { GITHUB_OUTPUT: out }, log: (m) => logs.push(m) })
  assert.deepEqual(lines.map((l) => l.id), ['suggestions/2026-11-19/a.json'])
  assert.ok(logs.some((m) => m.startsWith('skipped suggestions/2026-11-19/b.json')))
  assert.ok(logs.some((m) => m.startsWith('skipped suggestions/2026-11-20/c.json')))
  assert.ok(readFileSync(join(dir, 'prompt.txt'), 'utf8').includes(join(dir, 'groups.json')))
  assert.equal(readFileSync(out, 'utf8'), 'lines=1\n')
})

/** A fake `gh` that answers reads and records every call. */
function fakeGh({ issues = [], comments = [], labelsAfter = ['status:blocked'] } = {}) {
  const calls = []
  const gh = (args) => {
    calls.push(args)
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues)
    if (args[0] === 'api') return JSON.stringify([comments])
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ labels: labelsAfter.map((name) => ({ name })) })
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/x/y/issues/99\n'
    return ''
  }
  const writes = () => calls.filter((a) => !(a[0] === 'api' || (a[0] === 'issue' && ['list', 'view'].includes(a[1]))))
  return { gh, calls, writes }
}

const NOW = new Date('2026-11-20T08:00:00Z')
function dirWith(lines, groups) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-post-'))
  writeFileSync(join(dir, 'lines.json'), JSON.stringify(lines))
  if (groups !== undefined) writeFileSync(join(dir, 'groups.json'), groups)
  return dir
}
const L = (id, over = {}) => ({ ...JSON.parse(good(over)), id })

// covers: T4
test('post on an empty log with no standing issue → clear, creates nothing', () => {
  const f = fakeGh()
  const logs = []
  const r = post(dirWith([]), { gh: f.gh, now: NOW, log: (m) => logs.push(m), repo: 'x/y' })
  assert.equal(r.decision, 'clear')
  assert.deepEqual(f.writes(), [])
  assert.ok(logs.includes('nothing to show'))
})

test('post on an empty log with a standing issue → removes status:blocked only', () => {
  const f = fakeGh({ issues: [{ number: 5 }] })
  post(dirWith([]), { gh: f.gh, now: NOW, log: () => {}, repo: 'x/y' })
  assert.deepEqual(f.writes(), [['issue', 'edit', '5', '--repo', 'x/y', '--remove-label', 'status:blocked']])
})

test('post --dry-run writes nothing even when there is something to post', () => {
  const f = fakeGh()
  const logs = []
  const r = post(dirWith([L('suggestions/2026-11-19/a.json')]), { dryRun: true, gh: f.gh, now: NOW, log: (m) => logs.push(m), repo: 'x/y' })
  assert.equal(r.decision, 'post')
  assert.deepEqual(f.writes(), [])
  assert.ok(logs.some((m) => m.includes('would post') && m.includes('<!-- suggestions-daily:v1 date=2026-11-20')))
})

// covers: T4 (the plan check runs with no GitHub token)
test('post --dry-run with no GitHub token → still previews (nothing to show), exit 0; a real post still fails', () => {
  const noToken = () => { throw new Error('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.') }
  const logs = []
  const r = post(dirWith([]), { dryRun: true, gh: noToken, now: NOW, log: (m) => logs.push(m), repo: 'x/y' })
  assert.equal(r.decision, 'clear')
  assert.equal(r.number, null)
  assert.ok(logs.includes('nothing to show'))
  assert.throws(() => post(dirWith([]), { gh: noToken, now: NOW, log: () => {}, repo: 'x/y' }), /GH_TOKEN/)
})

test('post with no standing issue → label, issue, comment, then remove + add status:blocked and check it', () => {
  const f = fakeGh()
  const lines = [L('suggestions/2026-11-19/a.json'), L('suggestions/2026-11-19/b.json')]
  const r = post(dirWith(lines, JSON.stringify([{ title: 'Same', ids: lines.map((l) => l.id) }])), { gh: f.gh, now: NOW, log: () => {}, repo: 'x/y' })
  assert.equal(r.number, 99)
  assert.match(r.body, /seen 2×/)
  const w = f.writes().map((a) => a.slice(0, 2).join(' '))
  assert.deepEqual(w, ['label create', 'issue create', 'issue comment', 'issue edit', 'issue edit'])
  const create = f.writes()[1]
  assert.ok(create.includes(LABEL) && create.includes('meta:agents'))
  assert.deepEqual(f.writes()[3].slice(-2), ['--remove-label', 'status:blocked'])
  assert.deepEqual(f.writes()[4].slice(-2), ['--add-label', 'status:blocked'])
  assert.deepEqual(f.calls.at(-1).slice(0, 2), ['issue', 'view'])
})

test('post fails when status:blocked is not on the issue afterwards', () => {
  const f = fakeGh({ issues: [{ number: 5 }], labelsAfter: [] })
  assert.throws(() => post(dirWith([L('suggestions/2026-11-19/a.json')]), { gh: f.gh, now: NOW, log: () => {}, repo: 'x/y' }), /status:blocked is not on #5/)
})

test('post skips when today is already posted, and a missing groups.json still lists the lines', () => {
  const lines = [L('suggestions/2026-11-19/a.json')]
  const today = { author: { login: 'github-actions[bot]' }, body: '<!-- suggestions-daily:v1 date=2026-11-20 ids=x -->', createdAt: '2026-11-20T07:00:00Z' }
  const f = fakeGh({ issues: [{ number: 5 }], comments: [today] })
  const r = post(dirWith(lines), { gh: f.gh, now: NOW, log: () => {}, repo: 'x/y' })
  assert.equal(r.decision, 'skip-duplicate')
  assert.deepEqual(f.writes(), [])
  assert.match(r.body, /^1\. One idea — seen 1×/m)
})

test('post with no lines.json (gather did not finish) fails and writes nothing', () => {
  const f = fakeGh({ issues: [{ number: 5 }] })
  const dir = mkdtempSync(join(tmpdir(), 'sd-post-'))
  assert.throws(() => post(dir, { gh: f.gh, now: NOW, log: () => {}, repo: 'x/y' }), /gather step did not finish/)
  assert.deepEqual(f.calls, [])
})

test('post with an unparsable groups.json says the list is not grouped', () => {
  const f = fakeGh()
  const r = post(dirWith([L('suggestions/2026-11-19/a.json')], '{oops'), { dryRun: true, gh: f.gh, now: NOW, log: () => {}, repo: 'x/y' })
  assert.match(r.body, /not grouped/)
})
