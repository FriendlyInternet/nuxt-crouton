// An epic closes by itself only when it is on main, its test card is ok'd (or it has none) and its
// postmortem is posted (#3012). A wrong verdict either closes an epic the owner never tested, or
// leaves a finished one open forever.
//   node --test scripts/epic-auto-close.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideAutoClose, runAutoClose, DEPLOY_PATHS } from './epic-auto-close.mjs'
import { CARD_MARKER } from './test-card.mjs'

const merged = [{ number: 9, state: 'closed', merged_at: 'x', head: { ref: 'epic/7-x' } }]
const bot = body => ({ body, user: { type: 'Bot', login: 'github-actions[bot]' } })
const human = body => ({ body, user: { type: 'User', login: 'someone' }, author_association: 'NONE' })
const PM = bot('<!-- postmortem:done epic=#7 -->\nretro')
const PM_SKIPPED = bot('<!-- postmortem:skipped epic=#7 -->\nno run')
const CARD = bot(`${CARD_MARKER}\nplease test`)
const kids = [{ number: 1, state: 'closed' }]
const base = { state: 'open', labels: ['epic'], subIssues: kids, prs: merged, comments: [PM], prFiles: ['scripts/x.mjs'] }
const has = (d, re) => d.waiting.some(w => re.test(w))

test('merged + no card + only scripts changed + postmortem done → close (pipeline-only epic)', () => {
  assert.equal(decideAutoClose(base).action, 'close')
})
test('merged + status:to-test + postmortem done → wait on the test card', () => {
  const d = decideAutoClose({ ...base, labels: ['epic', 'status:to-test'], comments: [PM, CARD] })
  assert.equal(d.action, 'wait')
  assert.ok(has(d, /test card waiting/))
})
test('merged + status:verified + no postmortem → wait on only the postmortem', () => {
  const d = decideAutoClose({ ...base, labels: ['epic', 'status:verified'], comments: [CARD] })
  assert.equal(d.action, 'wait')
  assert.deepEqual(d.waiting, ['postmortem not posted'])
})
test('order: card ok + postmortem before the merge → wait "not on main yet", then close once merged', () => {
  const early = { ...base, labels: ['epic', 'status:verified'], comments: [PM, CARD], prs: [] }
  const d = decideAutoClose(early)
  assert.equal(d.action, 'wait')
  assert.ok(has(d, /not on main yet/))
  assert.equal(decideAutoClose({ ...early, prs: merged }).action, 'close')
})
test('order: merged + postmortem before the card (app change) → wait "card not posted yet", close after ok', () => {
  const gap = { ...base, prFiles: ['apps/velo/x.vue'] }
  const d = decideAutoClose(gap)
  assert.equal(d.action, 'wait')
  assert.ok(has(d, /test card not posted yet/))
  assert.equal(decideAutoClose({ ...gap, labels: ['epic', 'status:verified'], comments: [PM, CARD] }).action, 'close')
})
test('status:failed (not ok) → wait', () => {
  const d = decideAutoClose({ ...base, labels: ['epic', 'status:failed'], comments: [PM, CARD] })
  assert.equal(d.action, 'wait')
  assert.ok(has(d, /not ok/))
})
test('already closed → none; no epic label → none', () => {
  assert.equal(decideAutoClose({ ...base, state: 'closed' }).action, 'none')
  assert.equal(decideAutoClose({ ...base, labels: [] }).action, 'none')
})
test('skipped postmortem, open sub-issue, open epic→main PR → wait, each named', () => {
  assert.ok(has(decideAutoClose({ ...base, comments: [PM_SKIPPED] }), /postmortem didn't run/))
  const kid = decideAutoClose({ ...base, subIssues: [{ number: 4, state: 'open' }] })
  assert.equal(kid.action, 'wait')
  assert.ok(has(kid, /#4/))
  const open = decideAutoClose({ ...base, prs: [{ number: 9, state: 'open', merged_at: null, head: { ref: 'epic/7-x' } }] })
  assert.equal(open.action, 'wait')
  assert.ok(has(open, /#9 \(epic→main PR still open\)/))
})
test('a card marker planted by a non-bot user is not a card', () => {
  const app = { ...base, prFiles: ['packages/crouton/x.ts'] }
  const d = decideAutoClose({ ...app, comments: [PM, human(`${CARD_MARKER}\nfake`)] })
  assert.ok(has(d, /test card not posted yet/))
  // …whereas a real (bot) card is one: it no longer waits for a card to be posted
  assert.ok(!has(decideAutoClose({ ...app, comments: [PM, CARD] }), /test card not posted yet/))
})
test('a bot card with neither status:to-test nor status:verified (label not added yet, or stripped on a reopen) → wait on the ok', () => {
  for (const prFiles of [['apps/velo/x.vue'], ['scripts/x.mjs']]) {
    const d = decideAutoClose({ ...base, labels: ['epic'], prFiles, comments: [PM, CARD] })
    assert.equal(d.action, 'wait')
    assert.ok(has(d, /test card waiting on your ok/))
  }
})
test('runAutoClose: a reopened epic with its card but no status:* labels → no close', async () => {
  const w = world({ labels: ['epic'] })
  await runAutoClose(w.ctx, { epic: '7', via: 'sub-issue' })
  assert.deepEqual(w.calls, [])
})
test('DEPLOY_PATHS matches on.push.paths in deploy-apps.yml (drift guard)', () => {
  const y = readFileSync(new URL('../.github/workflows/deploy-apps.yml', import.meta.url), 'utf8')
  const push = y.slice(y.indexOf('\n  push:'), y.indexOf('\n  pull_request:'))
  const paths = push.slice(push.indexOf('paths:')).split('\n').slice(1)
    .map(l => l.match(/^\s*-\s*'([^']+)'/)?.[1]).filter(Boolean)
  assert.ok(paths.length > 0)
  assert.deepEqual(DEPLOY_PATHS, paths)
})

// runAutoClose — the function the auto-close job runs — with a recording fake of the github-script octokit.
function world({ labels = ['epic', 'status:verified', 'status:ready-to-close'], comments = [PM, CARD], pulls = merged, files = ['apps/velo/x.vue'], state = 'open', reread = state } = {}) {
  const calls = []
  let gets = 0
  const listComments = Symbol('listComments')
  const listFiles = Symbol('listFiles')
  const github = {
    paginate: async (route) => {
      if (route === listComments) return comments
      if (route === listFiles) return files.map(filename => ({ filename }))
      if (String(route).includes('/sub_issues')) return kids
      throw new Error(`unexpected paginate ${String(route)}`)
    },
    rest: {
      issues: {
        get: async () => ({ data: { state: gets++ ? reread : state, labels: labels.map(name => ({ name })) } }),
        listComments,
        update: async p => { calls.push(['update', p.state, p.state_reason]) },
        removeLabel: async p => { calls.push(['removeLabel', p.name]) },
        createComment: async p => { calls.push(['comment', p.body]) },
      },
      pulls: { list: async () => ({ data: pulls }), listFiles },
    },
  }
  return { ctx: { github, context: { repo: { owner: 'o', repo: 'r' } }, core: { info: () => {} } }, calls }
}

test('runAutoClose: all three hold → closed as completed, every status:* stripped, one "closed by itself" comment', async () => {
  const w = world()
  await runAutoClose(w.ctx, { epic: '7', via: 'merge' })
  assert.deepEqual(w.calls.find(c => c[0] === 'update'), ['update', 'closed', 'completed'])
  assert.deepEqual(w.calls.filter(c => c[0] === 'removeLabel').map(c => c[1]), ['status:verified', 'status:ready-to-close'])
  const notes = w.calls.filter(c => c[0] === 'comment')
  assert.equal(notes.length, 1)
  assert.match(notes[0][1], /closed by itself/)
  assert.match(notes[0][1], /checked on: merge/)
})
test('runAutoClose: still waiting (card waiting) → no update, no comment', async () => {
  const w = world({ labels: ['epic', 'status:to-test'] })
  await runAutoClose(w.ctx, { epic: '7', via: 'sub-issue' })
  assert.deepEqual(w.calls, [])
})
test('runAutoClose: a racing run closed it first (re-read finds closed) → no update', async () => {
  const w = world({ reread: 'closed' })
  await runAutoClose(w.ctx, { epic: '7', via: 'dispatch' })
  assert.deepEqual(w.calls, [])
})

test('wiring: postmortem.yml has the auto-close job on the App token; the card handler never closes itself', () => {
  const y = readFileSync(new URL('../.github/workflows/postmortem.yml', import.meta.url), 'utf8')
  const job = y.slice(y.indexOf('\n  auto-close:'))
  assert.ok(job.length > 200, 'auto-close job exists')
  assert.match(job, /create-github-app-token/)
  assert.match(job, /needs: \[target, write, post\]/)
  assert.match(job, /needs\.write\.result != 'cancelled'/)
  assert.match(job, /github-token: \$\{\{ steps\.app-token\.outputs\.token \}\}/)
  assert.match(job, /runAutoClose\(/)
  const h = readFileSync(new URL('./handle-test-reply.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(h, /state: 'closed'/)
  assert.match(h, /workflow: 'postmortem\.yml'/)
})
